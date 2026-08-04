# @onurpi/turn-fold

Compact transcript rendering for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a
run. Earlier activity is replaced by one summary row directly below the user message. When the run
stops, that position holds the `Worked for …` line, using `s`, `m`, `h`, `d`, and `w` units as needed. All summary rows use the theme's warning color. User messages and every visible assistant message
show their local timestamp below the content in both compact and expanded modes. Turn Fold
keeps one padding line before the next user message instead of Pi's usual two. Tool rows and
intermediate assistant messages disappear, leaving the final response below the summary. Automatic
compactions during a turn appear as `compacted` in the summary instead of a separate transcript row.
Manual compactions performed while Pi is idle keep Pi's original row. Successful `edit` tool results add a compact per-turn diffstat such as `3 files +42 −11`. Each absolute file path appears below the summary with that file's cumulative additions and deletions. The counters use Pi's diff colors. A long path is truncated from the left so its filename and counters remain on one line. Interrupted runs retain their last partial response or a fallback message.

The extension preserves every normal session message and Pi's model context. It stores one small
custom boundary entry for each new agent run so extension-started runs replay correctly after a
restart. Compaction still controls what reaches the model. The normative behavior is defined in [SPEC.md](SPEC.md).

## Configuration

Turn Fold keeps transcript density, pre-compaction history, and window count independent.

| Setting        | Values                  | Default   | Behavior                                                        |
| -------------- | ----------------------- | --------- | --------------------------------------------------------------- |
| Density        | `compact`, `expanded`   | `compact` | Chooses summaries or Pi's original rows.                        |
| Pre-compaction | `show`, `hide`          | `show`    | Includes or omits messages before the newest compaction.        |
| Windows        | positive integer, `all` | `all`     | Limits the selected compaction windows or uses the full branch. |

`show` honors the window setting. Session JSONL messages and model context are unchanged.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/turn-fold/index.ts
```

The package is private and is not published yet.

## Controls

```text
/turn-fold                  open the density picker
/turn-fold compact          use the compact transcript
/turn-fold expanded         show the complete transcript
/turn-fold history          open bounded pages of the selected source transcript
/turn-fold pre-compaction show|hide|toggle
/turn-fold toggle           switch between compact and expanded
/turn-fold status           show density, pre-compaction history, and windows
/turn-fold windows 5        load exactly 5 compaction windows
/turn-fold windows +2       load 2 more windows
/turn-fold windows -1       unload 1 window
/turn-fold windows all      load the full active branch after confirmation
/turn-fold windows reset    return to the default of all
```

Use `/turn-fold toggle` or `Ctrl+Shift+O` to switch density. The shortcut submits the same command
through Pi's editor while preserving any draft text. During a response, the command waits for Pi to
settle; repeated shortcut presses do not queue extra toggles.

Turn Fold applies a requested view immediately when every required entry is already loaded. This
covers compacting rows, hiding pre-compaction history, reducing windows, and restoring rows that
remain in the active component tree. When a request needs entries omitted by sparse projection,
Turn Fold saves the configuration and reports `restart required`. Exit Pi and resume the session to
load those entries; `/reload` is not enough because Pi rebuilds the transcript before extension
projection is bound. `/turn-fold status` includes the pending restart state. A TUI started with
`--no-session` rejects widening that cannot survive a restart.

`Ctrl+O` remains Pi's separate tool-output detail toggle. While its editor wrapper is active, Turn
Fold enables Pi TUI's public shrink-clearing behavior so narrowing removes obsolete terminal rows.
It reasserts that behavior before an in-place change because Pi reapplies settings during `/reload`,
and restores the previous TUI value when the extension unloads. A shrink can cause a brief full
redraw. Turn Fold does not write terminal escape sequences or persist a global terminal setting.

## Transcript windows

Turn Fold selects all compaction windows by default. Numeric values start at the user or custom
prompt recorded by the nearest run boundary before the oldest selected compaction window and
continue through the active leaf. Older sessions fall back to the nearest user message. Changing
from a numeric value to `all` requires confirmation because expanded full-branch rendering can slow
editor input.

Window selection changes only the TUI path. Pi's model context remains compacted. Compact density
scans the selected source once, then gives Pi only the prompts and activity that can appear on
screen. `/turn-fold history` reads the same source through bounded pages when older details are
needed. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) for the design.

Turn Fold writes one strict `onurpi-turn-fold-run` entry during the first completed turn of each new
run. Automatic retries before settlement stay in the same run and do not add entries. Density,
pre-compaction visibility, and windows are stored together in one strict custom configuration entry.
Older incomplete configuration shapes are ignored. Automatic compaction associations live only in process memory and survive `/reload` without
writing to Pi's session. They use exact compaction and active-turn entry IDs and are limited to the
active branch. After a full Pi restart, earlier compactions remain standalone because Pi's stored
compaction entries do not identify their trigger. Historical turns are reconstructed from the active
session branch. Older `live` and `final-only` values are no longer modes and resolve to the compact
default.

## Current implementation boundary

Pi does not expose a public whole-turn renderer or transcript-range API. Turn Fold patches Pi's
built-in transcript component renderers and replaces the TUI-only `buildContextEntries()`
projection. It does not replace `buildSessionContext()`. The package targets
Pi 0.82.1 through 0.83.x and must be retested when Pi changes these interactive paths. The
[sparse transcript projection](TRANSCRIPT-PROJECTION.md) keeps hidden history out of Pi's active
component tree while preserving session and model context.

## Quality checks

```bash
npm run check
npm run slophammer
```

Optional manual mutation testing remains available with `npm run mutate`.
