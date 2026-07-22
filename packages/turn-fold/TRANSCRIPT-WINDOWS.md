# Turn Fold transcript windows

## Status

This document records the approved design for the next Turn Fold implementation. The current package still relies on the separate `pi-tui-history-replay` extension and always replays the full active branch.

## Goal

Long sessions must remain responsive while the user types. Turn Fold will load a bounded number of compaction windows into Pi's main transcript while leaving the model's compacted context unchanged.

A compaction window is an active-branch range between compaction entries. The current window begins after the latest compaction and ends at the active leaf. With a limit of three, the transcript shows the current window and the two windows before it.

## User experience

Turn Fold will load three compaction windows by default. One command handles absolute limits, relative changes, full history, and reset:

```text
/turn-fold windows 5      load exactly 5 windows
/turn-fold windows +2     load 2 more
/turn-fold windows -1     unload 1
/turn-fold windows all    load the full active branch
/turn-fold windows reset  return to the default of 3
```

Every successful change rebuilds the main transcript immediately. Relative subtraction stops at one window. There is no separate history screen. The transcript starts with the user message that led into the oldest loaded window and continues in branch order through the current leaf.

The selected value belongs to the current session and survives reload. `/turn-fold status` reports the mode and window value. Compact and expanded modes operate on the same selected transcript range. Expanded mode restores Pi's original rows within that range and does not load older windows.

`all` shows the active-branch entry count and asks for confirmation before rebuilding. The warning explains that full-history rendering can make editor input slow. Cancelling leaves the current value and transcript unchanged.

## Package ownership

Turn Fold will own transcript selection and folding as one installed extension. The responsibilities remain separate inside the package:

- a pure window policy selects active-branch entries
- a small Pi adapter supplies those entries to the TUI rebuild path
- turn state groups the selected entries
- render patches apply compact or expanded presentation

The implementation will remove `pi-tui-history-replay` from the root manifest, normalized settings, workspace checks, and repository package list. Its source will not be copied into Turn Fold. The replacement adapter will be implemented from the behavior required here, and the unlicensed vendored package will be deleted.

Keeping one extension in charge fixes an existing ordering risk. Turn Fold can install the transcript adapter before it reconstructs state, so its turn index and Pi's transcript use the same entry snapshot.

## Window selection

The selector receives `ctx.sessionManager.getBranch()` in root-to-leaf order and a resolved value of either a positive window limit or `all`. Relative command arguments use the current effective window count. Adding to `all` keeps `all`; subtracting from `all` produces a numeric limit below the active branch's total window count.

For `all`, selection returns the complete active branch. For a number, it collects compaction entries by branch position. If the branch contains at least as many compactions as the requested limit, the oldest selected boundary is the compaction whose reverse index equals the limit. For a limit of three, that is the third-newest compaction. If the branch has fewer compactions, selection starts at the branch root.

When a boundary exists, the selector walks backward to the nearest preceding user-message entry. The selected slice begins at that user entry and ends at the active leaf. This keeps the initiating prompt when compaction happened during a tool continuation.

Several compactions during one user turn naturally resolve to one anchor because selection produces one continuous branch slice. Entry IDs and branch positions define every boundary. Timestamps are display metadata only.

If no user entry precedes the boundary, selection starts at the boundary. Malformed entries are preserved for Pi's normal fallback rendering and do not abort transcript reconstruction.

## Runtime adapter

Pi builds the normal transcript through `sessionManager.buildContextEntries()`. The existing history replay extension replaces that method with a full-branch projection. Turn Fold will replace it with the bounded projection from the window policy.

The adapter affects only the TUI entry-building path. It must not replace or call through `buildSessionContext()`, which remains Pi's source for model messages. Compaction therefore continues to remove old messages from model context even when those messages remain visible in the selected transcript range.

The adapter will have one owner and one idempotent installation path. It will retain the pending-compaction handling needed to avoid rendering Pi's persisted and synthetic compaction rows twice during a rebuild. Session replacement and shutdown restore or discard session-scoped adapter state.

This method replacement is an undocumented compatibility boundary already used by `pi-tui-history-replay`. The new design adds no Pi source changes. A supported Pi release must pass integration tests before Turn Fold claims compatibility.

A future public transcript-range API should replace only this adapter. The window policy, command behavior, turn state, and tests can remain unchanged.

## Constant-time folding

Bounding history reduces transcript size, but long tool-heavy turns can still make editor input slow. Turn Fold currently performs repeated scans and sorts while rendering each component. Those decisions will move to state transitions.

Each turn group will keep a versioned layout with ordered activities, summary anchors, the final content anchor, cached counts, and an O(1) disposition for every component. Message and tool events update the layout. Settlement, interruption, compaction, history reconstruction, and mode changes invalidate only affected state.

A component render reads its cached disposition and returns immediately when hidden. It does not sort the group, rescan assistant content, or rebuild summary data. Pi will still call each selected component because its TUI container is eager, but hidden rows will do constant work.

## Configuration state

The existing Turn Fold custom config entry will store the mode and a window value that is either a positive integer or `all`. Entries that do not match the new complete shape are ignored, and the current defaults apply. The implementation will not add another custom entry type or a sidecar file.

Changing the limit appends one normal Turn Fold config entry and rebuilds the transcript from a fresh branch snapshot. A reload restores the latest valid config entry on the active branch. Tree navigation applies the selected range to the new branch.

## Implementation order

1. Add the pure compaction-window selector and user-anchor tests.
2. Add the bounded transcript adapter and model-context isolation tests.
3. Move adapter installation under Turn Fold and remove `pi-tui-history-replay`.
4. Add the `/turn-fold windows` value grammar and persist the complete Turn Fold config.
5. Replace render-time scans and sorts with versioned layouts.
6. Run long-session TUI tests against every supported Pi release.

## Verification

Selection tests must cover no compactions, fewer compactions than the limit, exact limits, more than the limit, compaction during a tool continuation, repeated compactions in one user turn, missing user anchors, malformed entries, and tree branches.

Integration tests must prove that absolute, relative, reset, and confirmed `all` changes rebuild the main transcript immediately and survive reload. Cancellation and invalid relative changes must leave the transcript untouched. Tests must also prove that `buildSessionContext()` remains compacted, pending compaction rows appear once, and Turn Fold indexes exactly the entries that Pi renders.

Performance tests will use long histories and tool-heavy turns. Repeated renders without state changes must not sort groups, rescan message content, or rebuild summaries. A window-limit change may perform one linear branch pass and one transcript rebuild.

## State impact

Pi's stored messages and model context remain unchanged. Turn Fold persists the selected window count in its existing config entry. It creates no message, label, tool-result metadata, or sidecar state. Pi core remains unmodified, while the bounded TUI projection stays isolated behind one adapter.
