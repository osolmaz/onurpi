# @onurpi/turn-fold

Compact transcript rendering and on-demand history for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a run. Earlier activity becomes one summary row below the user message. When the run stops, that row begins with `Worked for`. Tool rows and intermediate assistant messages disappear, leaving the final response below the summary.

Automatic compactions during a turn appear as `compacted` in the summary. Manual compactions performed while Pi is idle keep Pi's original row. Successful `edit` tool results add a per-turn diffstat such as `3 files +42 −11`, followed by each edited absolute path and its cumulative counters. Interrupted runs retain their last partial response or an interruption message.

The main transcript always stays compact. Full message history is available through a virtualized history explorer rendered inside Pi. The explorer takes over the full terminal as a borderless view with its own title and status rows, using Pi's documented overlay mechanism without margins. It starts with the newest three compaction windows, renders only viewport-near entries, and can load three older windows at a time without restarting Pi. Search, filters, direct jumps, and back or forward navigation make long histories easier to inspect.

Entries look like Pi's own transcript: user messages are full themed background blocks, assistant thinking and text are plain, tool calls and their results merge into one box with a bold tool header such as `read /path/to/file`, a short output preview, and a success or error background. Compactions and custom rows get labeled boxes. There are no role headers or timestamps in the body; the sticky status row keeps that context.

Turn Fold preserves every normal session message and Pi's model context. It stores one small custom boundary entry for each new agent run so extension-started runs replay correctly after a restart. Compaction still controls what reaches the model. [SPEC.md](SPEC.md) defines the required behavior.

## Configuration

Pre-compaction history and compact transcript windows are independent.

| Setting        | Values                  | Default | Behavior                                                 |
| -------------- | ----------------------- | ------- | -------------------------------------------------------- |
| Pre-compaction | `show`, `hide`          | `show`  | Includes or omits messages before the newest compaction. |
| Windows        | positive integer, `all` | `all`   | Limits compact summaries or uses the full active branch. |

These settings affect the compact main transcript. The history explorer always reads the complete active branch so older messages remain available. Session JSONL messages and model context are unchanged.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/turn-fold/index.ts
```

The package is private and is not published yet.

## Controls

```text
/turn-fold                  open the history explorer
/turn-fold history          open the history explorer
/turn-fold pre-compaction show|hide|toggle
/turn-fold status           show compact transcript scope
/turn-fold windows 5        use exactly 5 compact transcript windows
/turn-fold windows +2       add 2 compact transcript windows
/turn-fold windows -1       remove 1 compact transcript window
/turn-fold windows all      use the full active branch after confirmation
/turn-fold windows reset    return to the default of all
```

`Ctrl+Shift+O` opens the explorer through Pi's active editor without replacing draft text. During a response, the request waits for Pi to settle. Repeated shortcut presses do not queue duplicate requests. Inside the explorer, the same shortcut closes it.

The explorer uses these keys and pointer input:

```text
Mouse wheel          scroll three lines
Up / Down / b / f    one line back / forward
Left / Right / p / n one page back / forward
Space / PageUp/Dn    page, alternate keys
[ / ]                previous / next entry
{ / }                previous / next user message
Tab / Shift+Tab      forward / back in jump history
g / G                oldest admitted row / newest row
/                    edit search
n / N                next / previous match, while searching
F                    choose a role filter
j                    jump to a window, turn, match or timestamp
Enter                show more or less long text
t / o / d            thinking / tool output / diffs, this entry
T / O / D            thinking / tool output / diffs, all entries
?                    key reference
q / Esc              close or return from a subview
Ctrl+Shift+O         close from any explorer screen
```

User-message hops keep a couple of entries of context and record the position in jump history, so `Shift+Tab` walks back through them. Tool results show their call in a colored header (green-tinted on success, red-tinted on error) with a short output preview by default, and blocks are separated by exactly one blank line before each header so padding is symmetric at the top, bottom, and between entries. Help, filter and jump subviews always fill the screen, so the conversation never shows through.

In regular TUI mode, Turn Fold enables terminal mouse reporting (`?1002` with SGR `?1006`) through Pi's public terminal write API so the wheel can reach the overlay. It releases only the mouse modes that it acquired, exactly once, when the explorer closes. In fullscreen mode, Pi owns mouse reporting and forwards wheel input to the focused overlay, so Turn Fold does not change terminal mouse modes. Nothing is persisted; mouse clicks and motion are ignored.

Search is a case-insensitive literal scan of the complete active branch. It runs in bounded slices, highlights matching text, shows nearby entries, and admits older compaction windows when needed. Search and jump fields support standard terminal editing keys such as `Ctrl+A`, `Ctrl+E`, `Ctrl+W`, `Ctrl+K`, `Ctrl+U`, `Ctrl+Y`, word movement, Home, End, Delete and Backspace.

The filter menu covers all rows, users, assistants, tools, errors, compactions and custom rows. The jump field accepts `wN` for a compaction window, `tN` for a user turn, `mN` for a search match, `@HH:MM` or another timestamp, plus `oldest` and `newest`. User messages render as one continuous themed background block like Pi's main session. Thinking and tool output start expanded; lowercase keys toggle the focused entry and uppercase keys flip a section for every entry while clearing single-entry overrides.

The initial range contains the newest three compaction windows. Moving backward at the oldest admitted row loads three older windows and preserves the visible position. The sticky header reports the current role, timestamp, entry, compaction window, filter, search progress, and navigation history. Expanded entries continue through bounded detail pages, so scrolling can reach their full suffix without caching the full rendered body. Loaded extent, search, filters, scroll position, navigation history, and detailed entries are discarded when the explorer closes.

`Ctrl+O` remains Pi's separate tool-output detail toggle.

## Compact transcript transitions

Turn Fold applies compact scope changes immediately when every affected component is loaded and patchable. A request that changes the compact main transcript beyond those components is saved and marked `restart required`. This limitation applies only to main transcript window and pre-compaction settings. Opening or scrolling the history explorer never requires a restart.

Turn Fold enables Pi's public clear-on-shrink behavior while loaded and restores the previous value when the extension unloads. A shrink can briefly redraw the full screen. Turn Fold does not persist a global terminal setting. Its only terminal escape write is the regular-mode explorer's scoped mouse mode described above, which is released when the explorer closes.

## Transcript windows

A compaction window is an active-branch range between compaction entries. Numeric compact-transcript values start at the nearest recorded run boundary before the oldest selected compaction and continue through the active leaf. Older sessions fall back to the nearest user message.

The compact projection scans the selected source once and gives Pi only prompts and activity that can appear on screen. The history explorer builds a lightweight index over the complete branch without reading message bodies, then formats entries only as the viewport reaches them. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) and [TRANSCRIPT-PROJECTION.md](TRANSCRIPT-PROJECTION.md).

Turn Fold writes one strict `onurpi-turn-fold-run` entry during the first completed turn of each new run. Automatic retries before settlement stay in the same run. Pre-compaction visibility and windows are stored together in one strict configuration entry. Older configuration shapes, including persisted density, are ignored.

Automatic compaction associations live only in process memory and survive `/reload` without writing to Pi's session. After a full Pi restart, earlier compactions remain standalone because Pi's stored compaction entries do not identify their trigger.

## Current implementation boundary

Pi does not expose a public whole-turn renderer or transcript projection API. Turn Fold keeps its version-locked TUI-only `buildContextEntries()` adapter for the sparse main transcript. It does not replace `buildSessionContext()`.

The history explorer adds no private integration. It uses documented `ctx.ui.custom()` overlays, public Pi TUI components and key matching, Pi's theme, and the active session branch. It renders Turn Fold's own stable message and tool presentation because Pi does not expose a public factory for its native transcript components.

The package targets exactly Pi 0.84.3. Pi 0.84.2 is the first release that forwards fullscreen wheel input to a focused overlay, but Pi 0.84.3 changed the successful-compaction replay contract. Turn Fold disables its compact main-transcript adapter on any untested Pi version. The public history explorer remains available.

## Quality checks

```bash
npm run check
npm run slophammer
```

Optional manual mutation testing remains available with `npm run mutate`.
