# Turn Fold sparse transcript implementation plan

## Objective

Replace compact mode's render-time hiding with a sparse replay projection. Turn Fold will still scan
the selected history once to reconstruct accurate summaries, while Pi will create components only
for rows that compact mode can show.

The work is complete when the large-session regression meets the latency limits in
[TRANSCRIPT-PROJECTION.md](../packages/turn-fold/TRANSCRIPT-PROJECTION.md). All supported modes must
pass while normal session data and model context remain unchanged.

## Current behavior

`transcript-window-adapter.ts` currently returns the complete selected branch slice from
`SessionManager.buildContextEntries()`. Three windows selected 3,684 entries and 17.8 MB from the
reported 44 MB session because the oldest boundary fell inside one long run.

Pi creates assistant and tool components for that complete slice. Turn Fold later returns empty
lines for hidden components. Pi still visits every component on each editor render.

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
prompt and up to three recent activities. Other extensions' custom entries pass through.

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

Compact mode returns sparse entries. The current mode change command calls `ctx.reload()` when
moving between sparse replay and the temporary full expanded replay so Pi rebuilds the component
tree from the correct projection.

Keep live rendering incremental. Pi's successful compaction path already clears the chat container
and calls the adapted replay method, which removes hidden live-tail components. Do not patch
`InteractiveMode` or private Pi container state.

### Projection budget

Add a fixed compact-mode component budget after the sparse path works. Use repeated measurements to
choose the default because the current three-window entry count does not bound components. The
default should keep the large-session fixture below the latency limits with room for normal footer
and editor work.

When the selected history exceeds the budget, retain the newest complete runs and put the
omitted-run count on the oldest retained anchor. Test one giant run, 4,228 short runs, many rendered
custom entries, and a branch where the oldest retained run ends in a tool result.

Do not add a second configuration version for the budget. It is a safety limit on the existing
compact transcript contract. A future user setting requires a separate data-model review.

### Paged history

Add the on-demand viewer only after sparse compact replay passes its latency gate. The viewer should
use `ctx.ui.custom()` and load one run or bounded page at a time from the source snapshot. It must
discard old page components on navigation and close cleanly in TUI mode.

Non-TUI modes do not create the viewer. `/turn-fold expanded` can keep its temporary full-replay
behavior until the viewer is complete, but compact replay must stay sparse throughout this stage.

Once the viewer covers the raw-history use case, replace full expanded replay in place. Do not keep
a second legacy expansion path.

### Compatibility guard

Keep private replay integration inside `transcript-window-adapter.ts`. Add runtime checks for the
method shape and a package-level Pi version range matching tested releases. The guard should disable
sparse replay and leave Pi's original method in place when checks fail.

Add an integration fixture that imports the installed Pi release, opens a temporary session,
installs the adapter, verifies projected replay, simulates compaction rebuild, restores the adapter,
and checks the original method again.

## Verification

### Unit and integration tests

Add tests for projection identity, ordering, final-row selection, tool-call pairing, compaction
omission, custom-entry pass-through, budget clipping, and fallback behavior. Extend render tests to
prove that replay creates no component for hidden source entries.

Run existing compact, expanded, timestamp, diffstat, interruption, failure, and run-boundary tests
unchanged where their contract still applies. Keep the existing window-selection coverage as well.
Update tests that currently expect hidden components to exist.

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
npm run check
npm run slophammer
git diff --check
```

Run the Turn Fold extension-load smoke test against the supported Pi release. Mutation tests remain
outside normal completion checks.

## Delivery order

Ship the work as coherent slices on one branch:

1. Pure projection and tests.
2. Atomic adapter and fallback tests.
3. Snapshot cache and render simplification.
4. Compact replay integration and latency benchmark.
5. Projection budget.
6. Paged history and replacement of full expanded replay.

Each slice must preserve normal Pi session and model behavior. Stop before the next slice when the
active slice fails the session or latency gates.

## Contract impact

The sparse projection itself writes no session state. Existing `onurpi-turn-fold-run` and
`onurpi-turn-fold-config` entries keep their current schema and behavior. No sidecar file or
settings field is added.

The implementation changes no Pi source. It continues to use the existing private
`buildContextEntries()` adapter and adds no second private seam. Public APIs used by the later
viewer are `ctx.ui.custom()`, lifecycle events, `ctx.reload()`, and the documented mode checks.

## Removal condition

When Pi exposes a public transcript projection or viewport provider, replace
`transcript-window-adapter.ts` with that API. Remove the private method replacement in the same
change. The pure projection and run snapshots should remain usable. The same applies to the
projection budget and paged-history tests.
