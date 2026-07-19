# Settled turn output metrics implementation plan

## Goal

Turn-fold should include cumulative output tokens in each settled summary without writing new
session entries or depending on live-stats.

The completed row should read:

```text
▶ Worked for 14s · 438 out · 8 tools · 2 msgs · Ctrl+Shift+O
```

If one or more assistant responses lack provider-reported output usage, the row should mark the
combined count as approximate:

```text
▶ Worked for 14s · ~438 out · 8 tools · 2 msgs · Ctrl+Shift+O
```

The active folded row should remain unchanged. Pi's working row already shows the changing output
count and recent throughput while an agent run is active.

## Source of truth

Finalized assistant messages already contain the data needed for a settled summary. Turn-fold should
read those messages and derive the token count each time it builds or reconstructs a turn group. It
should not append a metrics entry to the session.

Each assistant response contributes one token count. A response with a positive, finite
`usage.output` value contributes that exact value. When the value is zero, missing, malformed, or
non-finite and the response has output content, turn-fold should estimate the missing contribution
from the finalized content. A response with no output content contributes zero without making the
turn approximate.

The estimate should match live-stats' current rule:

```text
estimated tokens = ceil(output content characters / 4)
```

Output content includes visible text, thinking text, and tool calls. A tool call contributes the
length of its name plus the length of its JSON-serialized arguments. Invalid history data should be
skipped so rendering continues.

A turn is approximate when at least one nonzero response contribution was estimated. Exact and
estimated responses may be combined, but the resulting total must retain the approximate marker.

## Pure aggregation module

Add `packages/turn-fold/output-metrics.ts`. This module should have no Pi event, session, or TUI
dependencies. It should accept `unknown` at the history boundary and validate every field before
use.

The public contract within the package should be small:

```ts
export type OutputTokenTotal = {
  approximate: boolean;
  tokens: number;
};

export function deriveAssistantOutput(message: unknown): OutputTokenTotal;

export function combineOutputTotals(totals: readonly OutputTokenTotal[]): OutputTokenTotal;
```

`deriveAssistantOutput()` should perform the exact-first calculation for one finalized assistant
message. `combineOutputTotals()` should sum token counts and propagate approximation. Keeping this
logic outside `turn-state.ts` lets state management focus on grouping and lets tests exercise token
semantics without constructing TUI components.

The module should own the four-characters-per-token constant. Turn-fold should not import from
live-stats because either extension must remain installable on its own. The duplicated policy is
intentional until Pi exposes a public derived-metrics API. Tests in both packages should pin the
same rule so an accidental change is visible.

## Turn state

Extend `FoldSummary` in `packages/turn-fold/turn-state.ts`:

```ts
export type FoldSummary = {
  aborted: boolean;
  durationMs: number;
  failedTools: number;
  intermediateMessages: number;
  outputApproximate: boolean;
  outputTokens: number;
  running: boolean;
  tools: number;
};
```

Store finalized output totals on `TurnGroup` independently from render components. The current
assistant-component map supports fold anchoring, but durable metrics should not depend on whether a
component has rendered. Add a map keyed by the finalized assistant snapshot key:

```ts
finalizedAssistantOutputs: Map<string, OutputTokenTotal>;
```

Add state methods that queue and finalize assistant output idempotently. `message_end` should record
the target group in response order. At `agent_settled`, read the matching finalized assistant
messages from the end of `ctx.sessionManager.getBranch()`. Pi has applied every chained
`message_end` replacement before persisting those messages, so this path matches session history
even when turn-fold receives an intermediate replacement object. Store each result by finalized
assistant key. Replacing instead of appending prevents duplicate totals if Pi replays an event.

Historical reconstruction can derive output immediately in `indexHistoricalAssistant` because those
messages are already final. Streaming `message_update` events should continue to update grouping
state without adding output totals. This avoids counting partial content and prevents assistant keys
that change while tool calls stream from appearing as separate responses.

`summary()` should combine the group's finalized assistant outputs. Running summaries may carry the
calculated fields internally, but their renderer should omit them.

## Rendering

Update `formatFoldSummary()` in `packages/turn-fold/render-patches.ts`. Insert output tokens
directly after duration and before tool count on settled rows.

Use compact formatting consistent with the working row:

| Value       | Text   |
| ----------- | ------ |
| `999`       | `999`  |
| `1_000`     | `1K`   |
| `1_250`     | `1.3K` |
| `12_500`    | `13K`  |
| `1_250_000` | `1.3M` |

Prefix the formatted value with `~` when `outputApproximate` is true. Preserve the existing order of
tool, intermediate-message, failure, and shortcut fields. Continue to pass the complete row through
`truncateToWidth()` so narrow terminals remain safe.

Do not add recent or average throughput to the settled row. Recent throughput describes the last
five seconds of generation and may be zero after a tool wait. Dividing tokens by total turn duration
would mix model generation with tool execution and would not represent decode speed.

## Event wiring

Update the assistant `message_end` handler in `packages/turn-fold/index.ts` to queue its current
group before abort handling. In `agent_settled`, pair those queued groups with the latest persisted
assistant messages from the active branch. Derive output before settling the group. The handlers
should remain safe for normal, aborted, and error responses.

No changes are needed in `packages/live-stats/`. It remains responsible for the active working row
and resets its in-memory tracker after the agent settles.

## Tests

Add `packages/turn-fold/output-metrics.test.ts` for the pure calculation. Cover:

- exact provider usage
- text and thinking estimation
- tool-call name and argument estimation
- zero usage with nonempty finalized content
- an empty response
- malformed usage and content
- mixed exact and estimated totals
- multiple exact responses

Extend `packages/turn-fold/turn-state.test.ts` with completed multi-response turns, aborted turns,
and history reconstruction. Assert that a historical summary has the same output total before and
after TUI component association. This test protects the separation between durable turn data and
render state.

Update `packages/turn-fold/render-patches.test.ts` for exact and approximate rows. Keep coverage for
failures, abort notices, running summaries, blank-line placement, and narrow widths.

## Quality configuration

Add `output-metrics.ts` to the mutation targets in:

- `packages/turn-fold/stryker.config.mjs`
- `packages/turn-fold/slophammer.yml`
- root `stryker.config.mjs`
- root `slophammer.yml`

The package Vitest configuration already includes ordinary TypeScript source files. Add the new file
to root `vitest.config.ts` so root coverage measures it explicitly.

Update `packages/turn-fold/README.md` with the new settled-row example and the
exact-versus-estimated rule. The README should state that turn-fold derives the count from existing
messages and stores no additional metrics data.

## Validation

Run the repository-required checks from the workspace root:

```bash
npm run check
npm run mutate
npm run slophammer
git diff --check
```

Also run the standalone package checks:

```bash
npm --workspace @onurpi/turn-fold run check
npm --workspace @onurpi/turn-fold run mutate
npm --workspace @onurpi/turn-fold run slophammer
```

Load the extension through Pi after tests pass and exercise one direct response, one tool-using
response, and one aborted response. Restart Pi and confirm that the same token totals appear when
the session branch is reconstructed.

## Pi core evolution

The local aggregation module should be treated as an implementation of a future Pi-derived metrics
contract. A core API can eventually calculate finalized turn metrics on demand from the same session
messages:

```ts
ctx.sessionManager.getTurnMetrics(turnId);
```

That API should return raw values and approximation provenance. Each view remains responsible for
formatting. Pi can then normalize provider usage in one place while keeping live-only throughput in
memory.

When the core API becomes available, turn-fold should replace `output-metrics.ts` with the public
API and remove the local estimator in the same change. The session format does not need a migration
because this implementation never adds a private metrics record.
