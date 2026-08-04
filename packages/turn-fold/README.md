# @onurpi/turn-fold

Compact transcript rendering and on-demand history for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a run. Earlier activity becomes one summary row below the user message. When the run stops, that row begins with `Worked for`. Tool rows and intermediate assistant messages disappear, leaving the final response below the summary.

Automatic compactions during a turn appear as `compacted` in the summary. Manual compactions performed while Pi is idle keep Pi's original row. Successful `edit` tool results add a per-turn diffstat such as `3 files +42 −11`, followed by each edited absolute path and its cumulative counters. Interrupted runs retain their last partial response or an interruption message.

The main transcript always stays compact. Full message history is available through a virtualized history explorer rendered inside Pi. The explorer starts with the newest three compaction windows, renders only viewport-near entries, and can load three older windows at a time without restarting Pi.

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

The explorer uses these keys:

```text
Up / Ctrl+P       one line backward
Down / Ctrl+N     one line forward
b                 one screen backward
Space             one screen forward
g / G             oldest admitted row / newest row
Enter             show more or less of the current entry
q / Esc           close
```

The initial range contains the newest three compaction windows. Moving backward at the oldest admitted row loads three older windows and preserves the visible position. The header reports the admitted and total window counts. Loaded extent, scroll position, and detailed entries are discarded when the explorer closes.

`Ctrl+O` remains Pi's separate tool-output detail toggle.

## Compact transcript transitions

Turn Fold applies compact scope changes immediately when every affected component is loaded and patchable. A request that changes the compact main transcript beyond those components is saved and marked `restart required`. This limitation applies only to main transcript window and pre-compaction settings. Opening or scrolling the history explorer never requires a restart.

Turn Fold enables Pi's public clear-on-shrink behavior while loaded and restores the previous value when the extension unloads. A shrink can briefly redraw the full screen. Turn Fold does not write terminal escape sequences or persist a global terminal setting.

## Transcript windows

A compaction window is an active-branch range between compaction entries. Numeric compact-transcript values start at the nearest recorded run boundary before the oldest selected compaction and continue through the active leaf. Older sessions fall back to the nearest user message.

The compact projection scans the selected source once and gives Pi only prompts and activity that can appear on screen. The history explorer builds a lightweight index over the complete branch without reading message bodies, then formats entries only as the viewport reaches them. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) and [TRANSCRIPT-PROJECTION.md](TRANSCRIPT-PROJECTION.md).

Turn Fold writes one strict `onurpi-turn-fold-run` entry during the first completed turn of each new run. Automatic retries before settlement stay in the same run. Pre-compaction visibility and windows are stored together in one strict configuration entry. Older configuration shapes, including persisted density, are ignored.

Automatic compaction associations live only in process memory and survive `/reload` without writing to Pi's session. After a full Pi restart, earlier compactions remain standalone because Pi's stored compaction entries do not identify their trigger.

## Current implementation boundary

Pi does not expose a public whole-turn renderer or transcript projection API. Turn Fold keeps its version-locked TUI-only `buildContextEntries()` adapter for the sparse main transcript. It does not replace `buildSessionContext()`.

The history explorer adds no private integration. It uses documented `ctx.ui.custom()` overlays, public Pi TUI components and key matching, Pi's theme, and the active session branch. It renders Turn Fold's own stable message and tool presentation because Pi does not expose a public factory for its native transcript components.

The package targets Pi 0.82.1 through 0.83.x and must be retested when Pi changes the interactive replay path.

## Quality checks

```bash
npm run check
npm run slophammer
```

Optional manual mutation testing remains available with `npm run mutate`.
