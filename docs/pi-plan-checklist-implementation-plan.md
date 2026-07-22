# Pi plan checklist implementation plan

This plan adds a Codex-style checklist to OnurPi as an independent Pi package. The extension will
register an `update_plan` model tool, reconstruct the current checklist from ordinary Pi tool
results, render updates in the transcript, and show the current checklist above the editor.

The implementation follows the observed Codex behavior in
[`codex-update-plan-spec.md`](codex-update-plan-spec.md), with a few deliberate validation and
continuity improvements listed below. It targets the documented public APIs in Pi 0.81.1.

## Desired result

A model can publish the complete current checklist with one tool call:

```json
{
  "explanation": "Implementation is complete, so verification is now active.",
  "plan": [
    { "step": "Inspect the existing extension APIs", "status": "completed" },
    { "step": "Implement plan state and rendering", "status": "completed" },
    { "step": "Run package and workspace checks", "status": "in_progress" }
  ]
}
```

Every successful call replaces the previous checklist. The latest successful `update_plan` tool
result on the active session branch is the durable source of truth. The extension keeps an in-memory
projection for fast rendering and rebuilds it when the active branch changes.

The package will be named `@onurpi/plan-checklist` and live under `packages/plan-checklist/`. It
will not implement Pi Plan mode, issue tracking, automatic task completion, or human editing.

## Public API classification

Pi's public extension API is sufficient for this feature. The implementation will use:

- `pi.registerTool()` with `promptSnippet`, `promptGuidelines`, custom renderers, and
  `executionMode: "sequential"`
- standard tool-result `details` for branch-replayable state
- `ctx.sessionManager.getBranch()` during lifecycle reconstruction
- the `session_start` and `session_tree` hooks, plus `session_compact` and `session_shutdown`
- the `context` event for a transient post-compaction continuity message
- `ctx.ui.setWidget()` for the current-plan TUI projection
- `StringEnum` from `@earendil-works/pi-ai`
- `Text` from `@earendil-works/pi-tui`, together with its helpers for measuring and constraining
  ANSI-styled lines

No private Pi API or source patch is required.

## Contract impact

Normal Pi behavior will append the assistant's `update_plan` tool call and its tool-result message
to a persisted session. The successful tool result will contain `{ plan }` in `details`. The
extension will not call `pi.appendEntry()`, `pi.sendMessage()`, or any `SessionManager` append
method.

There will be no settings schema, sidecar file, database, network call, or other persistent data.
The package will not modify Pi internals, session schemas, compaction entries, parent links, or
stored messages. The context continuity message will exist only in the copied message array returned
by the public `context` hook.

In `--no-session` mode, the checklist lasts only for the current process.

## Data contract

The model-facing request and durable result use related but separate types:

```ts
type PlanStatus = "pending" | "in_progress" | "completed";

type PlanStep = {
  step: string;
  status: PlanStatus;
};

type UpdatePlanInput = {
  explanation?: string;
  plan: PlanStep[];
};

type PlanSnapshot = {
  plan: PlanStep[];
};
```

`explanation` describes one update. It belongs in the tool arguments and transcript cell, while the
current checklist state needs only `plan`. A Schemator review of the durable payload reached the
same result and removed `explanation` from `PlanSnapshot`.

The implementation will not add IDs, timestamps, counters, priorities, dependencies, or a schema
version. Completed and total counts are derived from the plan array.

### Validation policy

The TypeBox schema and runtime decoder will apply these rules:

- `plan` is required and may be empty. An empty array clears the checklist.
- Each item contains only `step` and `status`.
- `step` is trimmed, must contain at least one character, and is limited to 500 characters.
- `status` uses the three-value `StringEnum`.
- `explanation` is trimmed, omitted when blank, and limited to 2,000 characters.
- A snapshot contains at most 64 steps.
- At most one step may be `in_progress`.
- Duplicate step text and arbitrary status transitions remain valid.
- Unknown fields are rejected at both object levels.

Replay treats stored details as untrusted input. Malformed details, failed tool results, and results
from another tool are ignored without changing the current snapshot.

These checks intentionally differ from Codex, which accepts blank steps, unbounded arrays, and
multiple active steps. The stricter rules keep the Pi widget bounded and enforce the model guidance
that Codex leaves advisory.

## Package structure

Create the package with these files:

```text
packages/plan-checklist/
├── AGENTS.md
├── README.md
├── eslint.config.mjs
├── index.ts
├── package.json
├── plan-context.ts
├── plan-context.test.ts
├── plan-render.ts
├── plan-render.test.ts
├── plan-replay.ts
├── plan-replay.test.ts
├── plan-schema.ts
├── plan-schema.test.ts
├── plan-state.ts
├── plan-state.test.ts
├── scripts/run-slophammer.sh
├── slophammer.yml
├── stryker.config.mjs
├── tsconfig.json
└── vitest.config.ts
```

`index.ts` will contain only extension registration and lifecycle wiring. Validation, replay,
context continuity, and rendering will remain pure modules that can be tested without starting Pi.
No new runtime dependency is needed.

## Implementation sequence

### Baseline and package scaffold

- [x] Fetch `origin` and rebase the feature branch onto the latest `origin/main` before changing
      implementation files.
- [x] Confirm the installed Pi version and compare it with the workspace development dependency.
      Keep the existing 0.80.10 development floor because every required public API is present, then
      smoke-test against the installed Pi 0.81.1.
- [x] Add `packages/plan-checklist/package.json` with the strict TypeScript and test setup used by
      the other OnurPi packages. Include coverage and Slophammer. Keep mutation scripts optional.
- [x] Add the package-local `AGENTS.md` and the standard quality configuration files.
- [x] Register `./packages/plan-checklist/index.ts` in the root Pi manifest.
- [x] Add the package's pure source files to root coverage collection.
- [x] Add package checks to `.github/workflows/ci.yml`. Keep mutation checks limited to manual
      `workflow_dispatch` runs.

The first slice is complete when an empty extension loads through Pi and all package and workspace
quality commands discover the new package.

### Schema and normalization

- [x] Define `PlanStatus` and `PlanStep` in `plan-schema.ts`, along with `UpdatePlanInput` and
      `PlanSnapshot`.
- [x] Build the tool schema with `Type.Object` and `Type.Array`, applying length bounds and
      `StringEnum` where appropriate.
- [x] Set `additionalProperties: false` on the request and step objects.
- [x] Implement one normalization function for live tool input. It trims text, omits a blank
      explanation, copies every array and object, and rejects more than one active step.
- [x] Implement a separate strict decoder for persisted `details: unknown`. It must return a new
      immutable snapshot or `undefined` and must never use an unchecked cast.
- [x] Add equality and completed-count helpers over normalized snapshots.

Tests will cover each boundary value, unknown keys, every status, blank text, empty plans, duplicate
steps, maximum lengths, maximum item count, and multiple active items.

### Branch replay and state cache

- [x] Implement `replayPlanSnapshot(entries)` in `plan-replay.ts`.
- [x] Walk the active branch in order and accept only successful `toolResult` messages whose
      `toolName` is `update_plan` and whose details pass the strict decoder.
- [x] Let each accepted result replace the previous snapshot. An accepted empty plan clears state.
- [x] Keep a small state controller in `plan-state.ts` with the current immutable snapshot and a
      monotonically increasing in-memory revision.
- [x] Rebuild the state controller from `ctx.sessionManager.getBranch()` on the
      `session_start`/`session_tree`/`session_compact` hooks.
- [x] Clear the controller and widget during `session_shutdown`.

Replay must preserve Pi's branch semantics. Navigating to a point before an update restores the
older snapshot or no snapshot. Returning to a later branch restores that branch's last valid update.
Replay reads the full active branch, so compaction does not alter the result. The model's
compaction-limited context is irrelevant to reconstruction.

The branch scan runs only during lifecycle reconstruction. Rendering and tool execution must not
scan session history.

### Tool registration

- [x] Register `update_plan` with label `Update Plan` and `executionMode: "sequential"`.
- [x] Describe full-snapshot replacement in the tool description.
- [x] Add a short `promptSnippet` so the tool appears in Pi's available-tools section.
- [x] Add guidelines that name `update_plan` explicitly. They should tell the model to use it for
      meaningful multi-step work, avoid one-step plans, keep one active step, publish complete
      snapshots, and update the checklist after verified progress.
- [x] Normalize and validate parameters before changing the state cache.
- [x] Return `Plan updated` with `details: { plan }` after a successful call.
- [x] Throw on semantic validation failure so Pi persists an error result with `isError: true` and
      leaves the previous snapshot unchanged.
- [x] Refresh the widget immediately after a successful call.

Sequential execution ensures sibling `update_plan` calls from one assistant message apply in source
order. The tool will not infer progress from shell commands, file changes, test output, or assistant
prose.

### Context continuity

- [x] Implement a pure detector that finds successful `update_plan` call/result pairs in a copied
      model-context message array.
- [x] Compare the latest visible successful plan with the branch-replayed snapshot.
- [x] Return the context unchanged when the current snapshot is already represented.
- [x] When a non-empty current snapshot has fallen out of compacted context, append one transient
      hidden `CustomMessage` that lists the current steps and asks the model to keep `update_plan`
      current.
- [x] Reuse a stable timestamp stored in the in-memory state so repeated provider requests produce
      stable bridge content.
- [x] Return no bridge for an empty plan.

The detector must not treat a valid-looking assistant call followed by an error result as current
state. The bridge message will be created only in the `context` event's deep-copied array and will
never be passed to `pi.sendMessage()` or a session append method.

Tests will cover an uncompacted visible update, an update missing after compaction, a stale visible
update, a failed update, an empty plan, and repeated calls with unchanged state.

### Transcript rendering

- [x] Implement custom `renderCall` and `renderResult` functions with Pi's default tool shell.
- [x] Render the title `Updated Plan` and trim blank explanations from `context.args`.
- [x] Use the Codex markers and styles. Pending steps use dim `□`. Active steps use bold accent `□`.
      Completed steps use dim crossed-out `✔`.
- [x] Show the complete bounded snapshot when tool output is expanded.
- [x] Keep collapsed output compact by showing completed/total progress, the active step, and a
      count of hidden steps.
- [x] Use ANSI-aware wrapping and truncation. Every rendered line must fit the width supplied by Pi.
- [x] Reuse `context.lastComponent` or cache by width and snapshot revision where this reduces work.
- [x] Rebuild themed strings from the callback theme after `invalidate()`.
- [x] Fall back to Pi's raw tool content if stored details are absent or malformed.

Rendering tests will check widths from narrow terminals through normal layouts, all statuses,
Unicode text, long explanations, long steps, empty plans, expanded and collapsed modes, malformed
legacy rows, and theme invalidation.

### Current-plan widget

- [x] Install an `aboveEditor` widget only when `ctx.mode === "tui"` and the current plan is
      non-empty.
- [x] Derive the widget from the same immutable state used by replay and tool rendering.
- [x] Show `Plan <completed>/<total>` followed by a bounded selection of steps.
- [x] Prefer the active step, nearby pending work, and the most recently completed step when more
      items exist than fit the widget budget.
- [x] End a truncated widget with `+N more`.
- [x] Cache rendered lines by width, theme invalidation, and state revision.
- [x] Clear the widget when the plan is empty, the active branch has no plan, or the session shuts
      down.

The widget will not set a footer status, terminal title, custom editor, timer, or overlay. It
remains independent from Nyan Mode and other OnurPi UI extensions.

### Repository integration and documentation

- [x] Add `@onurpi/plan-checklist` to the root README package list.
- [x] Write the package README with behavior and schema details. Cover lifecycle, persistence, the
      validation differences from Codex, installation steps, and public-API boundaries.
- [x] Link the Codex behavior specification from the package README.
- [x] Update `package-lock.json` through `npm install` or `npm ci` as appropriate.
- [x] Run `npm run settings:sync` if tracked settings must be regenerated. Do not edit tracked
      `settings.json` by hand.
- [x] Confirm the settings normalizer derives the new canonical package path from the root manifest.

The package README must state that plan completion is model-authored and does not prove that tests
or other checks passed.

## Verification

### Automated checks

Run these checks from the package directory:

```bash
npm run check
npm run slophammer
```

Run these checks from the repository root:

```bash
npm run check
npm run slophammer
git diff --check
```

Mutation scripts remain available but will not run during normal completion or CI.

### Extension smoke tests

- [x] Load the worktree package with `pi -e ./packages/plan-checklist/index.ts` and confirm that Pi
      reports no extension error.
- [x] Use RPC or an extension harness to confirm that `update_plan` is registered and active across
      TUI/RPC/JSON/print modes and `--no-session` configurations.
- [x] Execute a valid snapshot and verify the exact tool result, durable details, transcript
      rendering, and widget update.
- [x] Execute an invalid multiple-active snapshot and verify `isError: true` with no state change.
- [x] Execute an empty snapshot and verify that state and the widget clear.
- [x] Reload the extension and verify that the current plan is reconstructed.
- [x] Navigate between synthetic or temporary session branches and verify branch-specific state.
- [x] Compact a temporary session and verify both branch replay and the transient context bridge.
- [x] Confirm that no custom session entries, custom message entries, settings files, or sidecar
      files were created.

Use disposable sessions for smoke tests. Do not expose existing session contents or credentials in
test logs.

### Performance checks

- [x] Benchmark replay on a synthetic long branch. It may be linear in branch entries but must run
      only on lifecycle changes.
- [x] Benchmark repeated widget and transcript renders with the maximum 64-step plan.
- [x] Confirm steady-state rendering does not scan the session branch or sort the full plan on each
      keypress.
- [x] Confirm every component caches by width and invalidates correctly after state or theme
      changes.

## Acceptance criteria

Implementation is complete when all of the following hold:

- A valid `update_plan` call replaces the complete checklist and returns `Plan updated`.
- The persisted successful tool result contains only the normalized `plan` snapshot.
- Empty plans clear state, while failed or malformed updates preserve the previous state.
- At most one step can be active.
- Reload and every branch or compaction workflow restore the correct active-branch snapshot.
- A transient context message restores model visibility only when the current plan is absent from
  compacted context.
- Transcript rows and the current-plan widget stay within terminal width and remain responsive.
- TUI-only behavior is guarded, and non-TUI modes continue without prompts or terminal access.
- The extension uses documented Pi 0.81.1 APIs and introduces no Pi internal changes.
- The extension adds no persistence beyond Pi's ordinary assistant tool call and tool-result
  messages.
- Package and workspace checks, coverage, Slophammer, smoke tests, and `git diff --check` pass.

## Delivery

Implement the work in an isolated feature worktree. Commit coherent working slices with Conventional
Commit subjects. Before opening a pull request, review repository contribution rules and use the
`pr-description` skill. The pull request should cite the Codex behavior specification and state the
session contract clearly.

Do not merge or install the package into the live Pi settings without explicit authorization. After
an authorized merge, update the main checkout, run `npm ci`, normalize live settings with
`npm run settings:reset`, smoke-test the installed package, and remove the implementation worktree
and merged local branch.
