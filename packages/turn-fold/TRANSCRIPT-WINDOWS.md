# Turn Fold transcript windows

Turn Fold owns transcript selection and folding as one installed extension. It loads a bounded part of the active branch into Pi's main transcript and keeps the model's compacted context unchanged.

## Window model

A compaction window is the active-branch range between two compaction entries. The current window begins after the latest compaction and ends at the active leaf. The default value is three, which selects the current window and the two before it.

One command handles exact limits, relative changes, full history, and reset:

```text
/turn-fold windows 5      load exactly 5 windows
/turn-fold windows +2     load 2 more
/turn-fold windows -1     unload 1
/turn-fold windows all    load the full active branch
/turn-fold windows reset  return to the default of 3
```

After Pi becomes idle, every successful change persists the complete Turn Fold configuration before reloading the main transcript. Relative subtraction stops at one window. Adding to `all` keeps `all`; subtracting from `all` uses the active branch's effective window count.

`all` reports the active-branch entry count and asks for confirmation. Cancelling leaves the current value and transcript unchanged. `/turn-fold status` reports both the display mode and window value.

Compact and expanded modes operate on the same selected range. Expanded mode restores Pi's original rows within that range and does not load older entries.

## Entry selection

`transcript-windows.ts` receives `ctx.sessionManager.getBranch()` in root-to-leaf order. For a numeric value, it collects compaction positions and finds the requested oldest boundary. A value of three selects the third-newest compaction. If the branch contains fewer compactions, selection starts at the branch root. `all` returns the complete active branch.

When a numeric boundary exists, selection walks backward to the nearest `onurpi-turn-fold-run` entry. The marker's `promptEntryId` moves the start to the persisted user or custom prompt that began the run. A user-message entry remains the fallback for sessions without markers. The returned slice ends at the active leaf.

Turn Fold writes one marker during the first completed turn after a new run starts. Retries before `agent_settled` stay in the same run and do not add markers. The marker carries only version, run ID, prompt entry ID, and start time. It never enters model context.

Several compactions during one run naturally resolve to one anchor because the selector returns one continuous branch slice. Entry IDs and branch positions define boundaries. Timestamps are display metadata only. If no run or user anchor precedes a boundary, selection starts at the compaction.

## TUI adapter

Pi builds its main transcript through `SessionManager.buildContextEntries()`. `transcript-window-adapter.ts` replaces that TUI-only projection with the selected branch slice. The adapter has one idempotent owner and keeps its current value in session-manager-local memory so it survives extension reload.

The adapter never replaces `buildSessionContext()`, which remains Pi's source for model messages. Compaction therefore removes old messages from model context even when the selected transcript range still displays them.

During compaction, Pi rebuilds stored rows and then appends a synthetic live summary. The adapter omits the pending persisted compaction entry from one rebuild so the summary appears once. The next projection includes the stored entry again.

This method replacement is an undocumented compatibility boundary. Turn Fold isolates it in one module and adds no Pi source changes. A future public transcript-range API can replace the adapter while the remaining Turn Fold behavior stays unchanged.

## Folding performance

Pi calls every loaded transcript component whenever it draws a TUI frame. Turn Fold previously scanned and sorted a turn's components inside each render call, which made editor input slower as turns grew.

`TurnFoldState` now keeps a versioned layout for each turn. The layout caches recent activities, summary anchors, the final content anchor, failure counts, and component dispositions. Message, tool, compaction, and settlement events invalidate affected layouts. Unchanged renders reuse both the layout and assistant-content snapshots.

A hidden component returns before invoking its native Markdown or tool renderer. Pi still visits every component in the selected range. A long run can cross several compaction boundaries, so the three-window default does not reliably bound the component count.

The target design keeps the selected entries as a source snapshot for one-pass summary reconstruction and returns a sparse display projection to Pi. Compact replay will retain each prompt, one final display component for a settled run, and at most three activities for a reconstructed active run. Hidden source entries will remain in session and model history without entering Pi's component tree. [TRANSCRIPT-PROJECTION.md](TRANSCRIPT-PROJECTION.md) defines that behavior, and the [implementation plan](../../docs/turn-fold-sparse-transcript-implementation-plan.md) lists the delivery and latency gates.

## Configuration

The `onurpi-turn-fold-run` custom entry stores the strict run marker used for replay. The existing `onurpi-turn-fold-config` custom entry stores a complete object containing `mode` and `windows`. The window value is a positive safe integer or `all`. Entries that do not match the complete shape are ignored, and Turn Fold uses compact mode with three windows.

A command appends one configuration entry before reloading. Reload restores the latest valid entry on the active branch. Tree navigation applies the same value to the newly selected branch. Turn Fold writes no custom messages, labels, tool metadata, or sidecar files.

## Package replacement

The former `pi-tui-history-replay` package replayed the complete active branch and patched the same TUI path independently. Turn Fold now owns the bounded adapter, so package load order cannot leave its state index out of sync with Pi's rendered entries.

The unlicensed vendored package has been removed. None of its source was copied into the replacement modules.

## Verification

Unit tests cover exact and relative values, reset, `all`, user anchoring, repeated compactions, missing anchors, malformed values, pending compaction rows, and adapter reuse. Integration tests verify that commands persist complete configuration and reload the selected range.

Turn-state tests verify that unchanged renders do not sort activity or rescan assistant content. Workspace checks and the Pi extension-load smoke test cover the package alongside the rest of OnurPi.
