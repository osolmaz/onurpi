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

## Modes

| Mode       | Behavior                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `compact`  | Shows a summary below the user message, followed by live or final activity.                           |
| `expanded` | Shows Pi's original rows within the loaded transcript range without synthetic diffstats or path rows. |

`compact` is the default.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/turn-fold/index.ts
```

The package is private and is not published yet.

## Controls

```text
/turn-fold                  open the mode picker
/turn-fold compact          use the compact transcript
/turn-fold expanded         show the complete transcript
/turn-fold history          open bounded pages of the selected source transcript
/turn-fold toggle           switch between compact and expanded
/turn-fold status           show the current mode and window value
/turn-fold windows 5        load exactly 5 compaction windows
/turn-fold windows +2       load 2 more windows
/turn-fold windows -1       unload 1 window
/turn-fold windows all      load the full active branch after confirmation
/turn-fold windows reset    return to the default of 3
```

Use `/turn-fold toggle` or `Ctrl+Shift+O` to switch modes. The shortcut submits the same command
through Pi's editor while preserving any draft text. During a response, the command waits for Pi to
settle; repeated shortcut presses do not queue extra toggles. Turn Fold stores the new configuration.
Expansion resumes the current session so hidden rows can return. Compaction folds the currently
loaded components in place, avoiding a replacement replay that would restore Pi's native rows
before the new extension projection is bound. Running `compact` while it is already selected
refreshes those components after a Pi reload. `Ctrl+O` remains Pi's separate tool-output detail
toggle. While its editor wrapper is active, Turn Fold enables Pi TUI's public shrink-clearing
behavior so compact mode removes rows left by the longer expanded transcript. It reasserts that
behavior before compaction because Pi reapplies settings after extension startup during `/reload`,
and restores the previous TUI value when the extension unloads.
This can cause a brief full-redraw flicker when content shrinks. Turn Fold does not write terminal
escape sequences or persist a global setting. A TUI started with `--no-session` keeps its startup
projection and rejects replay-setting changes because Pi has no public in-memory transcript rebuild
action.

## Transcript windows

Turn Fold loads three compaction windows into the main transcript by default. Changing the window
value waits for Pi to become idle, then rebuilds that transcript. The selected range begins with the
user or custom prompt recorded by the nearest run boundary before its oldest compaction window and
continues through the active leaf. Older sessions fall back to the nearest user message. `all` warns before replaying
the full branch because a large transcript can slow editor input.

Window selection changes only the TUI path. Pi's model context remains compacted. Compact mode
scans the selected source once, then gives Pi only the prompts and activity that can appear on
screen. `/turn-fold history` reads the same source through bounded pages when older details are
needed. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) for the design.

Turn Fold writes one strict `onurpi-turn-fold-run` entry during the first completed turn of each new
run. Automatic retries before settlement stay in the same run and do not add entries. Mode and
window changes are stored as separate custom session entries, so each session restores its latest
supported configuration. Automatic compaction associations live only in process memory and survive `/reload` without
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
