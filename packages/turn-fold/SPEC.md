# Turn Fold behavior specification

Turn Fold is a display-only transcript compactor for the Pi coding agent. It groups transcript rows into turns and reduces the visible activity without changing Pi's session data or model context.

This document defines the required behavior. The README explains how to use the extension. Tests and implementation must conform to this specification.

## Terms

A **turn** starts with a user message and includes the assistant messages and tool executions that follow it until Pi settles the run. Agent continuations, tool round trips, retries, and provider errors remain in the same turn.

An **activity row** is a visible assistant text or thinking row, or a tool execution row. An assistant shell that contains only tool calls is not an activity row.

A **summary line** is a synthetic row created by Turn Fold. A running turn may have a **streaming summary line**. A settled turn has a **settled summary line**, which begins with `Worked for`.

The **final content row** is the one assistant or tool row retained after a compact turn settles.

## Display invariants

Turn Fold MUST preserve the native user message and render its local timestamp as dim, right-aligned metadata on its bottom line. The retained final content row shows the local completion time beneath its content. Timestamps use `HH:mm` for the current local date and `YYYY-MM-DD HH:mm` for older dates.

In compact mode, every summary line MUST occupy the first Turn Fold-managed position after the user message. Activity and final content appear below the summary line. Turn Fold MUST NOT place a summary line below the final content row.

Turn Fold MUST leave Pi's working indicator under Pi's control. The working indicator remains visible while Pi is running and does not count toward the three-row activity limit.

A summary line MUST fit the available terminal width. Turn Fold may truncate it with an ellipsis. Interrupted and failed summaries use the theme's warning color; normal summaries use the muted color.

## Compact mode while streaming

Compact mode shows at most the latest three activity rows in transcript order.

When a turn has more than three activity rows, Turn Fold MUST replace all older activity with one streaming summary line. The line appears directly after the user message and before the retained activity rows.

The streaming summary reports the number of hidden earlier activities. It may also report cumulative tool and assistant-message counts. The counts cover the whole active turn, including hidden rows.

Example:

```text
User message

▶ 7 earlier activities · 8 tools · 9 msgs

latest activity 1
latest activity 2
latest activity 3

Working...
```

Turn Fold MUST invalidate existing transcript components whenever a new sequential activity changes the visible three-row window. Parallel tool rendering is not sufficient to verify this behavior.

## Compact mode after settlement

A settled compact turn MUST show one settled summary line followed by one final content row. Tool rows and intermediate assistant rows disappear.

```text
User message

▶ Worked for 14s · 8 tools · 9 msgs

Final assistant response
                              18:43
```

The settled summary reports elapsed time. It may include assistant-message, tool, failure, and output-token counts when those values are available. Zero-valued optional counts may be omitted.

The final content row is selected in this order:

1. The last terminal tool error when a provider ends on failed or incomplete tool calls.
2. The latest assistant row with visible content or a terminal notice.
3. The last tool result when no assistant row can represent the result.
4. A generated fallback message when the turn has no displayable assistant or tool content.

A normally completed turn should therefore retain the final assistant response. A tool-only turn retains its final tool result.

## Interrupted turns

An interrupted compact turn MUST retain one final content row below the settled summary line.

If Pi produced partial assistant text, that partial text is the final content row. If no partial text or tool result is available, Turn Fold renders `Operation interrupted` as the fallback.

The settled summary includes `interrupted`. The fallback or partial response MUST remain visible after reload.

```text
User message

▶ Worked for 11s · 1 msg · interrupted

Operation interrupted
                              18:43
```

## Failed turns

Terminal provider and tool failures MUST leave a useful error row below the settled summary. When several pending tool calls fail together, Turn Fold retains the last failed tool row deterministically and counts every failure in the summary.

Stale partial assistant text MUST NOT replace a terminal tool error selected as the final content row.

## Expanded mode

Expanded mode shows Pi's original transcript rows in their original order. Turn Fold summary lines are hidden.

Switching between compact and expanded mode MUST update the existing transcript immediately. A single mode change MUST invalidate each affected component no more than once.

## History and reload

Turn Fold reconstructs turn groups from the active session branch when Pi starts, reloads, switches trees, or rebuilds the transcript after compaction.

The first rendered frame after reconstruction MUST obey the same compact-mode rules as a live turn. It MUST NOT briefly expose hidden intermediate rows, duplicate summaries, or choose an earlier tool as final output.

Distinct assistant messages remain distinct even when they share the same millisecond timestamp. Streaming updates for one assistant message still count as one message.

Elapsed time and the final-content timestamp come from persisted turn completion data when available. Time spent between saving and reopening a session MUST NOT increase the displayed duration. Epoch timestamps remain unchanged in session state and are formatted only for display.

## State boundaries

Turn Fold changes rendering only. It MUST NOT delete, rewrite, reorder, or hide messages from Pi's stored session or model context.

Mode changes are stored as custom session entries. The supported modes are exactly `compact` and `expanded`; unknown historical values resolve to `compact`.

## Controls

The extension provides these commands:

```text
/turn-fold
/turn-fold compact
/turn-fold expanded
/turn-fold toggle
/turn-fold status
```

`Ctrl+Shift+O` toggles the mode but does not appear in summary lines. `Ctrl+O` remains Pi's tool-output expansion control.

## Compatibility boundary

Turn Fold patches Pi's exported `AssistantMessageComponent` and `ToolExecutionComponent` because Pi 0.80.10 does not expose a whole-turn transcript renderer. Each supported Pi release requires component-level integration testing.

## Acceptance tests

A release is conforming only when automated or PTY tests verify all of the following:

- Ten sequential tool calls show one streaming summary, the latest three activities, and Pi's working indicator.
- User and final-content timestamps render in local time without changing stored epoch values.
- Settlement leaves the summary directly below the user message and one final content row below it.
- Interruption retains partial output or `Operation interrupted` below an interrupted summary.
- Terminal tool failures retain the correct failed tool row and failure count.
- Reload and history reconstruction produce the correct first frame.
- Compact and expanded mode switching updates the existing transcript.
- Session messages and model context are unchanged.
