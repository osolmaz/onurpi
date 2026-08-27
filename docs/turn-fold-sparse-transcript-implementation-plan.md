# Turn Fold sparse transcript implementation plan

## Objective

Replace compact mode's render-time hiding with a sparse replay projection. Turn Fold will still scan
the selected history once to reconstruct accurate summaries, while Pi will create components only
for rows that compact mode can show.

The work is complete when the large-session regression meets the latency limits in
[TRANSCRIPT-PROJECTION.md](../packages/turn-fold/TRANSCRIPT-PROJECTION.md). All supported modes must
pass while normal session data and model context remain unchanged.

## Implementation status

The sparse compact projection, atomic adapter, cached edit summaries, component budget, and paged
history viewer are implemented. The previous budget code selected pass-through rows and compact runs
in separate phases. That policy could leave gaps, omit a run prompt while keeping another row from
the run, and shift user timestamps during replay. The chronological window correction in this plan
replaces that policy.

The earlier 44 MB regression-session copy projected 3,684 selected entries to 33 entries and 18
estimated components. A repeated PTY test measured 20.11 ms p95 and 21.08 ms p99 key-to-echo latency
across 200 keypresses. Repository, live TUI, and CI checks remain the release gates.

## Original performance problem

Before sparse projection, `transcript-window-adapter.ts` returned the complete selected branch slice
from `SessionManager.buildContextEntries()`. Three windows selected 3,684 entries and 17.8 MB from
the reported 44 MB session because the oldest boundary fell inside one long run.

Pi created assistant and tool components for that complete slice. Turn Fold later returned empty
lines for hidden components. Pi still visited every component on each editor render.

The largest reconstructed run had 2,948 components and 364 edit results. A diagnostic simulation
called the edit-summary reducer 3,661 times and spent 679 ms there in one frame. One-window and
two-window simulations spent 0.56 ms and 3.85 ms. These single diagnostic observations do not
establish tail latency. The 675 ms absolute gap is far above the proposed 50 ms p95 limit and
identifies repeated aggregation as work to remove.

## Design

The implementation adds a pure projection stage between window selection and Pi's TUI replay. One
source snapshot feeds both Turn Fold state and the returned display entries.

A settled run normally contributes its user prompt plus one assistant or tool component. That second
component renders both the summary and final content. An active reconstructed run contributes its
prompt and up to three recent activities. Displayable extension rows keep their native renderers and
join either their owning run or the standalone position where they occurred.

The existing component patches remain for timestamps, summary formatting, native final content, and
the live tail. They stop doing history reduction and edit aggregation.

## Work sequence

### Projection model

Add `packages/turn-fold/transcript-projection.ts` and its tests. The module receives selected
entries plus reconstructed run metadata and returns a projection result containing:

```ts
type TranscriptProjection = {
  readonly sourceEntries: BranchEntries;
  readonly displayEntries: BranchEntries;
  readonly runSnapshots: ReadonlyMap<string, RunDisplaySnapshot>;
  readonly omittedRunCount: number;
};
```

The public type may change during implementation, but it must keep source analysis separate from
display entries. The module remains free of Pi TUI component imports.

Use original session entries in `displayEntries`. Build a set of retained entry IDs and filter the
source snapshot in one pass. Add helpers that retain the assistant source entry and matching tool
result for a final tool component.

Tests cover final assistant output, terminal tool errors, tool-only completion, interruption, an
active three-activity tail, attached and standalone compactions, repeated timestamps, unrelated
custom entries, and stable source ordering.

### Atomic adapter

Change `transcript-window-adapter.ts` so one `buildEntries()` call selects and reduces the source,
then publishes and returns a projection. The adapter will receive a projection callback from
`index.ts`. Turn Fold policy stays outside the adapter.

Capture Pi's original bound replay method during first installation. Preserve the symbol-owned
idempotent state across `/reload`. Add a restore method and use it during `session_shutdown` when
this adapter still owns the method.

The current `loadVisibleHistory()` path separately calls the adapted method and then loads state.
Remove that split. The projection callback publishes `TurnFoldState` before `buildEntries()`
returns, which keeps component association on the same snapshot that Pi is about to render.

Pending compaction omission remains a one-rebuild operation and runs before projection. A failed
callback logs one warning and calls the captured Pi method without retaining partial Turn Fold
state.

### Run snapshot cache

Refactor `TurnFoldState` so each group revision owns one `RunDisplaySnapshot`. Move edit summary
calculation and path resolution into snapshot construction. Cache the result until an event changes
that group.

Add direct methods for component disposition and anchor lookup. Render patches must be able to
answer whether a component is hidden before asking for a summary. The settled path should make one
snapshot lookup for its anchor and no snapshot lookup for omitted components, since omitted
components will not exist after replay.

Instrument snapshot builds and cache hits behind test-only counters. Tests assert that 100 unchanged
renders do not rebuild a snapshot, resolve a path, sort activity, or scan assistant content.

### Compact replay

Update `index.ts` to create the projection callback with the current working directory,
configuration, active mode, and process-local compaction associations. Session start, tree changes,
window changes, and compaction rebuilds all use that callback.

The compact transcript returns sparse entries. Detailed history now opens in the virtual explorer
described in
[2026-08-04-turn-fold-history-explorer-plan.md](2026-08-04-turn-fold-history-explorer-plan.md), so
the main transcript no longer switches to full replay.

Keep live rendering incremental. Pi's successful compaction path already clears the chat container
and calls the adapted replay method, which removes hidden live-tail components. Do not patch
`InteractiveMode` or private Pi container state.

### Projection budget

Keep the fixed default budget of 512 rendered components. Managed assistant and tool rows use the
existing component estimator. Each displayable pass-through entry keeps its existing cost of one. Do
not add a setting or a second configuration version for this safety limit.

Build a private source-ordered list of display units from the existing run and owner index. A run
unit contains its prompt, compact assistant or tool entries, and every displayable pass-through
entry owned by the run. A displayable pass-through entry with no owner is a standalone unit at its
original position.

Walk the units from newest to oldest. Retain a complete unit only when its full cost fits. Stop at
the first unit that does not fit and omit that unit and every older unit. Do not skip it to fill the
remaining budget with smaller old units. The cutoff can leave unused capacity.

If the newest or active run alone exceeds the complete limit, keep only its prompt and omit all
older units. This rule returns only that prompt when the limit is one. An older run that does not
fit receives no fallback and becomes the cutoff.

Filter the source snapshot once using retained original entry objects. Preserve object identity and
source order. Calculate the component count, omitted-run count, and oldest retained prompt from the
same unit selection. The cutoff run counts as omitted. A prompt-only newest run does not. Do not
create a synthetic anchor.

Keep general group visibility based on retained run content. Build the positional user queue only
from retained entries whose message role is `user`. Remove stale groups during reconstruction, reset
the cursor, and add the active group at most once. This keeps Pi 0.84.3 user timestamps aligned
without adding a private component identity hook.

The projection is recalculated through the existing replay and supported refresh paths. Live rows
can remain after the last projection until Pi rebuilds the transcript. Do not add another private
replay trigger. Keep compaction-first replay, adapter fallback, version checks, restart handling,
history source, model context, branch behavior, and persisted schemas unchanged.

Replace the old pass-through-first and run-core-first allocation code. This is one hard behavior
replacement with no compatibility path, feature flag, migration, or second selector.

### Virtual history

The follow-up explorer uses `ctx.ui.custom()` and keeps the compact transcript sparse. It starts
with three compaction windows, loads older windows in bounded groups, renders only viewport-near
entries, and releases all viewer state on close.

Non-TUI modes do not create the explorer. The bounded viewer replaces the removed persistent
expanded replay.
[2026-08-04-turn-fold-history-explorer-plan.md](2026-08-04-turn-fold-history-explorer-plan.md)
records the replacement.

### Compatibility guard

Keep private replay integration inside `transcript-window-adapter.ts`. Add runtime checks for the
method shape and a package-level Pi version range matching tested releases. The guard should disable
sparse replay and leave Pi's original method in place when checks fail.

Add an integration fixture that imports the installed Pi release, opens a temporary session,
installs the adapter, verifies projected replay, simulates compaction rebuild, restores the adapter,
and checks the original method again.

## Verification

### Unit and integration tests

Add tests for a normal chronological suffix, stopping at the first overflow, top-only movement,
whole-run ownership, standalone chronology, exact component costs, source identity and order,
omission metadata, and the one-component limit. Cover oversized newest and active runs, plus older
runs. Also cover assistant and tool finals, attached and standalone compactions, branch summaries,
shell entries, and extension rows. Extend render tests to prove that replay creates no component for
hidden source entries.

Test the timestamp queue with promptless-row regression cases, duplicate user text, replay
reconstruction, active user creation, and the next live user row. Run existing compact transcript,
timestamp, diffstat, interruption, failure, run-boundary, compaction, branch, adapter fallback,
restart and version tests, plus window-selection tests where their contract still applies.

Add a generated fixture with hundreds of runs and about 200 user prompts. Include more than 600
workflow custom messages and compactions, plus large assistant and tool batches. Use generated text
only. Run a separate read-only aggregate diagnostic against the supplied long session. Check the
512-component limit, one retained unit suffix, prompt ownership, original identity and order,
omission metadata, and timestamp alignment. Do not copy private message bodies into the repository
or logs.

Exercise TUI, RPC, JSON, print, and `--no-session`. Only TUI may install the replay projection or
history viewer.

### Latency benchmark

Use a PTY harness that waits for an idle editor. It sends distinct characters one at a time and
measures the interval from write to visible echo. Run five warmup characters followed by at least
100 measured characters per process and repeat the process ten times.

Record p50 and p95 latency plus p99 and maximum latency for the current implementation and the
sparse candidate under the same terminal dimensions and extension set. Also record CPU time,
resident memory, source entry count, projected entry count, component count, and snapshot builds.

The proposed limits of 50 ms p95 and 100 ms p99 are retrospective product thresholds. They represent
the point where local typing should feel immediate. Maintainer acceptance of these limits is
required before they become a release gate.

### Repository checks

Run these checks from the repository root:

```bash
npm run check --workspace @onurpi/turn-fold
npm run check
npm run slophammer
git diff --check
pi --no-session --no-extensions -e ./packages/turn-fold/index.ts
```

The smoke test must load Turn Fold with Pi 0.84.3 and exit without writing a session. Run
`pi-reviewer` against `main` until no P0 or P1 findings remain, address valid proportionate P2
findings, inspect pull request comments, and require green relevant CI. Mutation tests remain
outside normal completion checks.

## Delivery order

Ship the chronological window correction as coherent slices on one branch:

1. Update the projection specification and this plan.
2. Add the display-unit builder and one reverse cutoff selector.
3. Align the projected user timestamp queue.
4. Replace old priority tests and add the generated long-session fixture.
5. Run the read-only long-session diagnostic and all repository checks.
6. Complete review and CI, then publish and perform the authorized merge.

Each slice must preserve normal Pi session and model behavior. Stop before the next slice when the
active slice fails its tests or verification gates.

## Contract impact

The sparse projection itself writes no session state. Existing `onurpi-turn-fold-run` entries keep
their schema and behavior. Compact transcript configuration keeps the strict
`{ preCompaction, windows }` shape. The explorer adds no sidecar file or settings field. Existing
sessions use the chronological selector on their next replay and need no migration.

The implementation changes no Pi source. It continues to use the existing private
`buildContextEntries()` adapter and adds no second private seam. Public APIs used by the later
viewer are `ctx.ui.custom()`, lifecycle events, `ctx.reload()`, and the documented mode checks.

## Removal condition

When Pi exposes a public transcript projection or viewport provider, replace
`transcript-window-adapter.ts` with that API. Remove the private method replacement in the same
change. The pure projection and run snapshots should remain usable. The same applies to the
projection budget and paged-history tests.
