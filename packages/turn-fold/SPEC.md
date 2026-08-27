# Turn Fold behavior specification

Turn Fold is a transcript compactor for the Pi coding agent. It groups transcript rows into settled agent runs and reduces visible activity without changing normal Pi messages or model context. It stores one small custom run-boundary entry for replay, plus its existing explicit configuration entries.

This document defines the required behavior. The README explains how to use the extension. Tests and implementation must conform to this specification.

## Terms

A **fold run** begins with a user message, including a queued user follow-up, or when an extension starts a custom-prompt agent run after the previous run settled. It includes the assistant messages and tool executions that follow. Tool round trips, automatic retries, compaction retries, and queued steering without a new user message remain together.

A **run boundary** is a `onurpi-turn-fold-run` custom entry containing `version`, `runId`, `promptEntryId`, and `startedAt`. Turn Fold writes it once during the first completed turn in a new fold run. It does not enter model context.

An **activity row** is a visible assistant text or thinking row, or a tool execution row. An assistant shell that contains only tool calls is not an activity row.

An **attached compaction** is an automatic threshold or overflow compaction observed while a Turn Fold turn is active. It also includes a compaction that the Codex controller marks through Pi's process-local event bus before its safe turn-boundary abort. Turn Fold keeps that run active until the controller's hidden continuation starts or the controller releases the hold. Attached compaction state is ephemeral display state and is not an activity row or final content row. A manual compaction performed while Pi is idle is a **standalone compaction**.

A **summary line** is a synthetic row created by Turn Fold. A running turn may have a **streaming summary line**. A settled turn has a **settled summary line**, which begins with `Worked for`.

An **edit diffstat** is the cumulative number of added and removed lines from successful finalized `edit` tool results in one turn, plus the number of unique edited files. Relative patch paths are resolved against Pi's working directory before display and deduplication. It describes edit operations. The final Git working-tree difference can be different.

The **final content row** is the one assistant or tool row retained after a compact turn settles.

A **display unit** is one item in compact replay selection. A run unit contains its prompt, its compact assistant or tool representation, and every displayable pass-through entry owned by that run. A displayable pass-through entry with no run owner is a standalone unit.

The **chronological suffix** is the newest uninterrupted sequence of complete display units that fits the component budget.

A **compaction window** is an active-branch range between compaction entries. The current window ends at the active leaf. The **window value** is a positive integer or `all` and controls how much of the active branch Pi renders in its main transcript. **Pre-compaction visibility** is `show` or `hide`; `hide` starts the main transcript at the newest compaction boundary after window selection.

## Display invariants

Turn Fold MUST apply compact transcript configuration in this order: select windows, then apply pre-compaction visibility. A numeric range starts at the nearest persisted run boundary before its oldest compaction boundary and includes that boundary's prompt entry. A user message remains the fallback anchor for sessions that predate run boundaries. `all` selects the complete active branch. `show` preserves the selected range. `hide` removes entries before the newest compaction while retaining that compaction entry and everything after it.

Compact replay MUST keep one chronological suffix of display units. It walks units from newest to oldest and keeps each complete unit while its full component cost fits. At the first unit that does not fit, selection stops. That unit and every older unit are omitted, even when a smaller older unit would fit. The cutoff may leave part of the budget unused.

A run unit MUST be kept or omitted as a whole. No assistant, tool, compaction, shell, branch-summary, custom, or extension row owned by a run may remain in compact replay without that run's prompt. Standalone units keep their source position and receive no reserved capacity or priority.

If the newest or active run alone exceeds the complete component budget, Turn Fold MUST retain only its prompt and omit every older unit. This fallback also applies when the component limit is one. An older run that does not fit becomes the cutoff and receives no fallback.

Turn Fold MUST preserve the native user message and render its local timestamp as dim, right-aligned metadata on its bottom line. Every visible assistant message MUST show its local timestamp as dim, right-aligned metadata beneath its content. When a user row follows another turn, Turn Fold suppresses Pi's outer separator and keeps the user message's built-in top padding, so only one blank line remains. Timestamps use `HH:mm` for the current local date and `YYYY-MM-DD HH:mm` for older dates.

Every summary line MUST occupy the first Turn Fold-managed position after the user message. Activity and final content appear below the summary line. Turn Fold MUST NOT place a summary line below the final content row.

Turn Fold MUST leave Pi's working and compaction status indicators under Pi's control. The working indicator remains visible while Pi is running and does not count toward the three-row activity limit.

A summary line MUST fit the available terminal width. Turn Fold may truncate it with an ellipsis. Normal summary text uses the theme's warning color. Edit additions use `toolDiffAdded`, and edit deletions use `toolDiffRemoved`.

When an edit diffstat is present, Turn Fold MUST render every unique absolute file path directly below the summary line in first-edit order. Each path row ends with that file's cumulative addition and deletion counts. Path text uses `toolDiffContext`; the counters use `toolDiffAdded` and `toolDiffRemoved`. Each file occupies exactly one row before retained activity or final content. When the complete row exceeds the terminal width, Turn Fold truncates the path from the left while keeping the filename and counters visible. Control characters are escaped before rendering.

## Compact transcript while streaming

The compact transcript shows at most the latest three activity rows in transcript order.

When a turn has more than three activity rows, Turn Fold MUST replace all older activity with one streaming summary line. The line appears directly after the user message and before the retained activity rows.

The streaming summary reports the number of hidden earlier activities. It may also report cumulative tool and assistant-message counts. The counts cover the whole active turn, including hidden rows. Successful finalized edit results add the current edit diffstat. When the turn has an attached compaction, the summary also reports `compacted`, or the explicit count when more than one compaction occurred.

Example:

```text
User message

▶ 7 earlier activities · 8 tools · 9 msgs · 2 files +12 −4
  /workspace/project/src/a.ts +8 −1
  /workspace/project/src/b.ts +4 −3

latest activity 1
latest activity 2
latest activity 3

Working...
```

Turn Fold MUST invalidate existing transcript components whenever a new sequential activity changes the visible three-row window. Parallel tool rendering is not sufficient to verify this behavior.

## Compact transcript after settlement

A settled compact turn MUST show one settled summary line followed by one final content row. Tool rows and intermediate assistant rows disappear.

```text
User message

▶ Worked for 14s · 8 tools · 9 msgs · 2 files +12 −4
  /workspace/project/src/a.ts +8 −1
  /workspace/project/src/b.ts +4 −3

Final assistant response
                              18:43
```

The settled summary reports elapsed time with compact units from seconds through weeks, omitting zero-valued units. It may include assistant-message and tool counts, failure and compaction counts, and output-token counts when those values are available. Successful finalized edit results add a compact item such as `3 files +42 −11` and the per-file rows described above. A single attached compaction appears as `compacted`; multiple attached compactions use an explicit count. Zero-valued optional counts may be omitted.

The compact transcript MUST hide the original row for an attached compaction. If that row is the first Turn Fold-managed component, it may serve as the summary-line anchor. Turn Fold MUST also suppress Pi's outer spacer for a hidden or replaced attached compaction. Standalone compactions retain Pi's original row and spacing.

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

## History explorer

The main transcript is always compact. `/turn-fold`, `/turn-fold history`, and `Ctrl+Shift+O` MUST open a Pi TUI history explorer without changing compact transcript configuration. Opening, scrolling, loading older history, and closing MUST NOT require a restart or append a session entry. The explorer MUST present itself as a borderless full-screen view through the documented overlay mechanism with zero margins and full terminal height, with its own title and status rows instead of a boxed popup frame.

The explorer MUST read one active-branch snapshot, omit Turn Fold's internal run and configuration rows, index compaction boundaries without reading message bodies, and initially admit the newest three compaction windows. A backward movement at the oldest admitted row MUST admit at most three older windows for that input and preserve the visible anchor. Repeated bounded loads MUST reach the branch root. The header MUST report admitted and total windows.

The explorer MUST render only the viewport plus bounded overscan. It MUST cache a bounded number of entry blocks by entry identity, width, theme revision, entry controls, search query, detail page, and segment. Large entries begin with a bounded terminal-safe preview and can show more only after an explicit `Enter`. Expanded entries MUST remain split into bounded render segments and detail pages, and continuous scrolling MUST expose every page past any fixed character cap. Thinking and tool output MUST start expanded while diffs start collapsed. `t`, `o`, and `d` MUST control thinking, tool output, and diff-like content for the focused entry through per-entry overrides on a session default. `T`, `O`, and `D` MUST flip the same session default for all entries and clear that section's per-entry overrides. User entries MUST render every block line, including headers and separators, with the user message background and foreground from the public theme. The explorer MUST clear its index, scroll state, entry controls, and render cache when it closes.

The explorer MUST support `Up`, `Down`, `b`, `f`, and optional `Ctrl+P` or `Ctrl+N` for one line back or forward. It MUST support `Left`, `Right`, `p`, `n`, Space, and optional Page Up or Page Down for one page back or forward. `[` and `]` move to the previous or next entry. `{` and `}` move to the previous or next user message with nearby context and navigation-history recording. `g` and `G` move to the admitted start or newest content. `Tab` and `Shift+Tab` MUST navigate a bounded back and forward jump history after hops, searches, jumps and filter relocation. While a search is active, `n` and `N` navigate matches instead of pages. Page Up and Page Down MUST NOT be the only paths for any action. Tool blocks MUST merge the call and its result into one background-tinted box with a bounded output preview when collapsed, and blocks with backgrounds MUST pad with exactly one background-colored blank line above and below. The help subview MUST fill the full content height so the conversation never shows through. Filter and jump subviews MUST do the same.

`/` MUST open a bounded editable search field. Search MUST be case-insensitive and literal, scan the complete active branch in bounded entry and character slices, yield between slices, retain at most one bounded result per entry, and avoid rendering unseen entries. It MUST show scan progress and result count. `n` and `N` MUST navigate results with wrapping, admit the target window, highlight visible matches, reveal a matching collapsed section, and keep nearby transcript context visible. `Esc` MUST cancel search editing or clear active search before it closes the explorer.

`f` MUST open filters for all entries, user messages, assistant messages, tools, errors, compactions and custom rows. Search MUST honor the active filter. `j` MUST accept one-based window, user-turn and search-match targets, nearest timestamps, `oldest`, and `newest`. Invalid targets MUST leave the viewport unchanged. Jump, filter relocation, and search-result navigation MUST record bounded navigation history.

Search and jump fields MUST support arrows plus `Ctrl+A`, `Ctrl+E`, `Ctrl+W`, `Ctrl+K`, `Ctrl+U`, `Ctrl+Y`, `Ctrl+F`, `Ctrl+B`, `Alt+F`, `Alt+B`, `Alt+D`, `Alt+Backspace`, Home, End, Delete, Backspace, and `Ctrl+D`. Modified keys with no binding MUST NOT insert raw control text.

`?` MUST show a complete key reference without changing the viewport. `?`, `q`, or `Esc` returns from help, and help content MUST remain readable on short terminals through line or wheel scrolling. In normal browsing, `q` or `Esc` closes the explorer when no active search needs clearing. `Ctrl+Shift+O` MUST close from every explorer screen.

While the explorer is open in regular TUI mode, Turn Fold MAY enable terminal mouse reporting through Pi's public terminal write API so the mouse wheel scrolls the overlay. This is a bounded exception to the no-escape-sequences rule. The explorer MUST enable only `?1002` with SGR `?1006`, MUST release them exactly once for every close path including session shutdown, and MUST NOT persist or change any other terminal state. In fullscreen mode, Pi owns mouse reporting and Turn Fold MUST NOT write mouse enable or disable sequences. Wheel input MUST scroll three lines per notch, scroll help content while help is open, and ignore clicks, releases, motion, and horizontal wheel codes.

Explorer blocks MUST mirror Pi's transcript presentation using only public theme colors and Markdown: user entries render as full user-message background blocks, assistant thinking and text render plainly, each tool call and its result MUST merge into one box with a bold tool header built from the tool name and common command, query, URL or file-path arguments, a bounded output preview with a remaining-line hint, and the tool success or error background. Compactions and custom rows MUST render as labeled custom-message boxes. The body MUST NOT show role headers or timestamps; the sticky status row MUST report the focused role, local timestamp, entry position, current compaction window, filter, search progress, and navigation counts. The explorer MUST NOT import Pi's private transcript component classes.

A requested compact scope MUST apply in place when every required entry is already present in the active component tree and every omitted component can be hidden by Turn Fold's render integration. When a compact scope needs omitted entries or cannot hide a loaded unpatched row, Turn Fold MUST persist the request, leave the current component tree intact, and report that a full Pi restart is required. This restart rule applies only to the compact main transcript. While its editor wrapper is active, Turn Fold MUST enable Pi TUI's public shrink-clearing behavior and restore the previous value when it unloads. Turn Fold MUST NOT emit terminal clearing sequences or persist a global Pi setting.

## History and reload

Turn Fold reconstructs run groups from the selected active-branch range when Pi starts, reloads, switches trees, changes the window value, or rebuilds the transcript after compaction. It pre-indexes run boundaries so a marker written after a run's first assistant response still anchors the earlier prompt entry. Its run index and Pi's TUI projection MUST use the same entry snapshot.

The chronological suffix is recalculated when the existing Pi replay or supported in-place refresh path runs. Components added after replay form a live tail until the next replay. Turn Fold MUST NOT add another private replay trigger to remove that tail.

Every compact configuration change MUST wait for Pi to become idle before updating the active view. Changing from a numeric window value to `all` MUST report the active-branch entry count and require confirmation because scanning the full branch can increase startup work. Cancellation leaves the existing value and transcript unchanged. A TUI `--no-session` run MUST reject compact widening that requires omitted entries because the requested state cannot survive a full restart.

Turn Fold keeps attached compaction associations in process-local memory. The registry is keyed by Pi's session identity and exact compaction entry ID, and it retains the active turn's existing entry IDs so split turns can be restored without guessing. Associations are limited to compactions on the active branch. The registry survives `/reload` and is cleared when the Pi process exits. Turn Fold MUST NOT persist compaction associations in Pi's session or a sidecar store. After a full process restart, prior compactions remain standalone because Pi's stored compaction entries do not identify their trigger. Turn Fold MUST NOT infer automatic intent from timestamps or neighboring messages.

The first rendered frame after reconstruction MUST obey the same compact transcript rules as a live turn when its compaction association remains in the process registry. It MUST NOT briefly expose hidden intermediate rows, duplicate summaries, or choose an earlier tool as final output.

Distinct assistant messages remain distinct even when they share the same millisecond timestamp. Streaming updates for one assistant message still count as one message.

Elapsed time comes from persisted turn completion data when available. User and assistant timestamps come from their persisted message timestamps. Time spent between saving and reopening a session MUST NOT increase the displayed duration. Epoch timestamps remain unchanged in session state and are formatted only for display.

## State boundaries

Turn Fold MUST NOT delete, rewrite, reorder or hide messages from Pi's stored session or model context. Compaction folding MUST NOT append custom messages, labels, tool-result metadata or sidecar state.

Run boundaries are the first explicit persistence exception. Turn Fold appends exactly one compact `onurpi-turn-fold-run` custom entry for each new fold run, never for retries within the same unsettled run. Configuration changes are the second exception and are stored as strict `{ preCompaction, windows }` custom entries. Pre-compaction visibility is `show` or `hide`, and windows is a positive safe integer or `all`. Entries with missing, extra or invalid fields are ignored. Defaults are pre-compaction messages shown and all compact transcript windows. Old entries containing density are ignored.

## Controls

The extension provides these commands:

```text
/turn-fold
/turn-fold history
/turn-fold pre-compaction show
/turn-fold pre-compaction hide
/turn-fold pre-compaction toggle
/turn-fold status
/turn-fold windows 5
/turn-fold windows +2
/turn-fold windows -1
/turn-fold windows all
/turn-fold windows reset
```

`Ctrl+Shift+O` MUST submit `/turn-fold history` through Pi's active editor without replacing draft text. During a response, the command MUST wait for Pi to settle, and repeated shortcut presses MUST NOT start extra requests. The explorer MUST handle the same shortcut directly to close. `pre-compaction toggle` switches only pre-compaction visibility. `Ctrl+O` remains Pi's tool-output expansion control.

## Compatibility boundary

Turn Fold patches Pi's built-in transcript component renderers because supported Pi releases do not expose a whole-turn transcript renderer. It also replaces the TUI-only `SessionManager.buildContextEntries()` projection because Pi does not expose a transcript-range API. It MUST NOT replace `buildSessionContext()`. Each supported Pi release requires component-level integration testing. [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) records this design boundary.

[TRANSCRIPT-PROJECTION.md](TRANSCRIPT-PROJECTION.md) specifies the compact transcript's sparse replay behavior. Hidden source entries contribute to summaries without becoming Pi components. The history explorer uses only documented overlay, component, key matching, theme, and session branch APIs.

## Acceptance tests

A release is conforming only when automated or PTY tests verify all of the following:

- Ten sequential tool calls show one streaming summary, the latest three activities, and Pi's working indicator.
- User and every visible assistant timestamp render in local time without changing stored epoch values.
- Settlement leaves the summary directly below the user message and one final content row below it.
- Interruption retains partial output or `Operation interrupted` below an interrupted summary.
- Terminal tool failures retain the correct failed tool row and failure count.
- Reload and history reconstruction produce the correct first frame for process-local associations.
- The compact transcript hides attached automatic compaction rows and reports them in the turn summary.
- A forced Codex turn-boundary compaction remains attached across the controller abort, settlement, manual Pi compaction call, and hidden continuation.
- A failed forced compaction releases its display hold and settles the interrupted run.
- Manual and unobserved compactions remain standalone. Compactions seen after restart also remain standalone.
- Compaction display coordination performs no Pi session or sidecar writes.
- The explorer initially admits the newest three compaction windows and loads at most three older windows for one backward boundary action.
- The explorer renders viewport-near entries through documented Pi TUI APIs and keeps its render cache bounded.
- Explorer open, scroll, older-history loading, and close never require a restart or append session state.
- Pre-compaction visibility and compact window changes apply in place when their required entries are loaded.
- Compact scope widening beyond loaded entries persists the request, reports `restart required`, and loads after a full restart.
- `Ctrl+Shift+O` submits the history command through the active editor, preserves draft text, waits safely while busy, suppresses duplicate pending requests, closes the explorer directly, and recovers after dispatch failure.
- Exact, relative, reset, and confirmed `all` window changes select the expected user-anchored range.
- `show` honors the selected windows; `hide` starts at the newest compaction boundary.
- Cancelling `all` and invalid arguments leave the transcript unchanged.
- Successful edit results aggregate exact patch line totals and unique files without double counting repeated tool-call IDs.
- Failed or malformed edit results do not affect the summary.
- Live and reconstructed turns produce the same edit diffstat from finalized tool-result messages.
- Compact diffstats use Pi's addition and deletion colors.
- Every compact diffstat lists unique absolute paths in first-edit order below the summary, shows cumulative colored counters beside each file, truncates long paths so each file fits one row, and escapes terminal controls.
- Compact replay creates no component for hidden source entries and remains within its component budget.
- Compact replay keeps one chronological suffix of complete run and standalone units, stops at the first overflow, and never fills a gap with older units.
- Adding a newest unit removes only a prefix of older units from the next projection.
- A retained run-owned row always has its prompt, while an omitted run contributes no display entry.
- A newest or active run that exceeds the full budget falls back to its prompt, including when the limit is one.
- Projected entries retain their original object identity and source order.
- Omitted-run counts and the oldest retained prompt come from the same retained unit set.
- Replayed and live user components take timestamps only from projected role-user prompts in the same order.
- Repeated unchanged renders perform no edit aggregation, path resolution, activity sorting, or assistant-content rescans.
- User-started and extension-started runs replay as separate groups after restart.
- Each new fold run appends one strict run-boundary entry, while retries append none.
- A synthetic 4,228-run transcript remains bounded by the configured compaction windows.
- Normal session messages and model context are unchanged.
