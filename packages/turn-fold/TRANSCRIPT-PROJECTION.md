# Turn Fold transcript projection

## Status

This document specifies Turn Fold's compact transcript projection and virtual history explorer. Earlier releases loaded every selected entry into Pi's component tree and hid most rows during rendering. The projection plan is in [../../docs/turn-fold-sparse-transcript-implementation-plan.md](../../docs/turn-fold-sparse-transcript-implementation-plan.md). The explorer plan is in [../../docs/2026-08-04-turn-fold-history-explorer-plan.md](../../docs/2026-08-04-turn-fold-history-explorer-plan.md).

## Purpose

Turn Fold needs the full selected history to count messages, tools, failures, compactions, and edit changes. Pi's main transcript needs only the rows that Turn Fold displays. The projection separates those two inputs so hidden history never becomes TUI components.

The projection affects display only. Pi's session tree, stored JSONL, compaction logic, and model context keep their existing behavior.

## Terms

The **source snapshot** is the active-branch entry range selected by the configured compaction windows. Turn Fold reads this snapshot to reconstruct runs and summaries.

The **display projection** is the ordered subset of source entries returned to Pi's TUI replay path.

A **display anchor** is an existing assistant or tool-call entry whose component renders a Turn Fold summary, retained activity, or final content. The projection does not create synthetic session entries.

The **live tail** contains components that Pi adds after the latest replay. Pi clears and rebuilds this tail after a successful compaction.

## Projection boundary

The projection MUST be installed only on the TUI replay instance method `SessionManager.buildContextEntries()`. It MUST NOT replace the exported context builder or `buildSessionContext()`. JSON, RPC, print, and model execution paths MUST remain unchanged.

The private adapter MUST live in `transcript-window-adapter.ts`. Folding policy, source reduction, and display selection MUST remain in pure modules that do not import Pi component classes.

The adapter MUST capture the original method before installation. Shutdown MUST restore that method when the adapter still owns it. A second installation MUST reuse the existing owner and MUST NOT wrap the method again.

## Atomic replay

Each replay MUST use one root-to-leaf branch snapshot. The adapter performs these steps in order:

1. Read the branch once.
2. Select the configured compaction windows from that branch.
3. Apply the one-rebuild pending-compaction omission.
4. Reduce the selected entries into Turn Fold run state.
5. Build the display projection from the same selected entries and run state.
6. Publish the new state and return the projected entries.

Turn Fold MUST NOT load state from one branch snapshot while returning entries from another. If reduction or projection fails, the adapter restores or calls Pi's original replay method and reports one warning. It MUST NOT return a partial projection.

## Compact settled runs

A settled run keeps its prompt row and one final display component. The final component follows the selection order in [SPEC.md](SPEC.md): terminal tool error, latest visible assistant content, final tool result, then the interruption fallback.

When the final component is an assistant message, the projection keeps its original message entry. The patched assistant renderer emits the cached settled summary followed by the original final content.

When the final component is a tool result, the projection keeps the assistant entry containing that tool call and its matching tool-result entry. Pi therefore creates one complete `ToolExecutionComponent`. The patched tool renderer emits the cached settled summary followed by the native final tool output.

Intermediate assistant entries, hidden tool-call source entries, and their tool results MUST stay out of the display projection. Their data remains available in the source snapshot and contributes to the summary.

## Compact active runs

A reconstructed active run keeps its prompt and at most the latest three activity components. The projection also keeps the entries needed to construct those components. A retained tool component requires both its assistant tool-call entry and matching tool-result entry when the result exists.

When earlier activity exists, the first retained activity acts as the streaming-summary anchor. The component renderer emits the cached summary before its native content. If no activity can serve as an anchor, Turn Fold retains one existing compaction or assistant entry that can render the summary without changing session data.

Components added after replay form the live tail. Render-time folding remains responsible for that tail until Pi's next successful compaction rebuild. Live-tail lookups MUST be constant time, and summary aggregation MUST happen only when an event changes the run.

## Compaction entries

An attached compaction contributes to its run summary and stays out of the compact display projection unless it is required as the only available summary anchor. A standalone compaction keeps Pi's original entry and spacing.

The process-local compaction registry remains the authority for this distinction. Projection MUST NOT infer attachment from timestamps, neighboring messages, or entry order.

Pi performs a transcript rebuild after every successful compaction. The rebuilt projection removes hidden live-tail components from the component tree.

## User and custom entries

Every prompt entry that begins a projected run remains in source order. Its native content and Turn Fold timestamp behavior stay unchanged.

Custom entries outside Turn Fold's managed assistant, tool, and compaction rows pass through unchanged. This preserves other extensions' registered entry renderers. Entering or leaving a scope that contains an unpatched custom entry, custom message, or branch summary requires a full restart because Turn Fold cannot patch that renderer in place. Turn Fold's own run-boundary and configuration entries continue to have no renderer and create no visible component.

The projection MUST preserve the original entry objects and ordering. It MUST NOT clone entries with changed messages, append display entries, or alter parent links.

## Cached run snapshots

Source reduction produces one immutable display snapshot per run revision. A snapshot contains the counts, elapsed time, completion state, selected anchors, edit summary, and pre-resolved file paths needed by renderers.

Successful finalized tool results update edit state once. Path resolution and per-file aggregation MUST NOT run from a component's `render(width)` method. Hidden-component lookups MUST NOT request a summary.

A display component may cache formatted lines by run revision, width, detail state, and theme identity. A stable editor keystroke MUST reuse the same run snapshot.

## Projection budget

Compact projection MUST have a hard component budget independent of the number of entries in one run or compaction window. The implementation defines a conservative default from the latency benchmark in the implementation plan.

If the selected windows contain more settled runs than the budget allows, Turn Fold keeps the newest complete runs. Native pass-through components, including branch summaries, persisted shell executions, standalone compactions, and unrelated extension entries, consume the same budget; the newest ones are retained when they fill it. The oldest retained display anchor reports how many earlier runs were omitted from the active transcript. Omitted entries remain in the source snapshot, session tree, and model history.

A single retained final message may exceed the ordinary byte estimate. Turn Fold may render a bounded preview in the main transcript and make the complete content available through the history viewer. It MUST NOT mutate or truncate the stored message.

## Virtual history

Compact projection remains active while the main editor is in use. `Ctrl+Shift+O` and `/turn-fold history` open hidden activity in a Pi overlay. The explorer reads a complete active-branch snapshot independently of the compact transcript's configured windows.

The explorer indexes compaction boundaries without reading message bodies. It initially admits the newest three windows. One backward action at the admitted boundary adds at most three older windows, and repeated loads can reach the root. Range growth preserves the visible entry anchor.

The explorer formats only entries needed for the viewport. Render blocks use a bounded cache and bounded previews. Closing releases the branch index, admitted range, position, detail state, and cache. Opening and scrolling have no effect on model context, stored session data, or compact transcript configuration.

The main transcript MUST remain sparse. Turn Fold MUST NOT retain full hidden transcript components merely to support history inspection.

## Compatibility checks

The adapter uses one undocumented Pi method and therefore requires a tested Pi version range. Startup MUST verify that the method exists, is callable, and returns a branch-entry array for a smoke fixture. An unsupported shape disables sparse projection and leaves Pi's original method installed.

The package MUST include integration tests against every supported Pi release. A Pi dependency update cannot ship until replay, compaction rebuild, explorer open and close, shutdown restoration, and non-TUI isolation pass.

## Performance requirements

The primary performance measure is key-to-echo latency in the compact transcript after session replay. The release fixture includes the 44 MB session that exposed the problem, or a sanitized structural equivalent with the same large-run and edit-result shape.

After warmup, at least ten measured runs MUST meet both limits:

- p95 key-to-echo latency below 50 ms
- p99 key-to-echo latency below 100 ms

The test also records selected source entries, projected entries, created components, cache hits, replay time, and peak resident memory. An unchanged frame MUST perform no edit aggregation, path resolution, activity sorting, or assistant-content scan.

## Regression result

The implementation was tested against a copy of the 44 MB session that exposed the delay. Three windows selected 3,684 entries. Sparse projection returned 33 entries and estimated 18 components. Projection took 6.48 ms and Turn Fold state reconstruction took 13.68 ms in the diagnostic run.

The PTY key-to-echo test started ten fresh Pi processes and sent 20 distinct characters to each process after warmup. Across 200 keypresses, p50 was 12.94 ms, p95 was 20.11 ms, p99 was 21.08 ms, and the maximum was 21.28 ms. The test used Pi 0.83.0, a 120 by 40 terminal, the real session copy, and only the worktree Turn Fold extension. The original session file was never opened for writing.

## State impact

Sparse projection and the history explorer add no session entries or sidecar files. Existing run-boundary entries remain unchanged. Compact transcript configuration uses the strict `{ preCompaction, windows }` shape. The implementation adds no provider messages, labels, tool-result fields, session schema, or Pi source modification.
