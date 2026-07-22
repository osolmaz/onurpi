# @onurpi/turn-fold

Compact transcript rendering for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a
run. Earlier activity is replaced by one summary row directly below the user message. When the run
stops, that position holds the `Worked for …` line. User messages show their local timestamp on the
bottom line, and the retained final response shows its completion time below the content. Turn Fold
keeps one padding line before the next user message instead of Pi's usual two. Tool rows and
intermediate assistant messages disappear, leaving the final response below the summary. Automatic
compactions during a turn appear as `compacted` in the summary instead of a separate transcript row.
Manual compactions performed while Pi is idle keep Pi's original row. Interrupted runs retain their
last partial response or a fallback message.

The extension changes only the display. Pi keeps every stored session message, while compaction still
controls what reaches the model. The normative behavior is defined in [SPEC.md](SPEC.md).

## Modes

| Mode       | Behavior                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `compact`  | Shows a summary below the user message, followed by live or final activity. |
| `expanded` | Shows Pi's original rows within the loaded transcript range.                |

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
/turn-fold toggle           switch between compact and expanded
/turn-fold status           show the current mode and window value
/turn-fold windows 5        load exactly 5 compaction windows
/turn-fold windows +2       load 2 more windows
/turn-fold windows -1       unload 1 window
/turn-fold windows all      load the full active branch after confirmation
/turn-fold windows reset    return to the default of 3
```

`Ctrl+Shift+O` switches between compact and expanded rendering without adding a shortcut hint to
summary lines. `Ctrl+O` remains Pi's separate tool-output detail toggle.

## Transcript windows

Turn Fold loads three compaction windows into the main transcript by default. Changing the window
value waits for Pi to become idle, then rebuilds that transcript. The selected range begins with the user message that led
into its oldest compaction window and continues through the active leaf. `all` warns before replaying
the full branch because a large transcript can slow editor input.

Window selection changes only the TUI path. Pi's model context remains compacted. Turn Fold also
caches the component layout and its counts so unchanged redraws avoid rescanning or sorting turn
activity. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) for the design.

Mode and window changes are stored as custom session entries, so each session restores its latest
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
Pi 0.80.10 or newer and must be retested when Pi changes these interactive paths.

## Quality checks

```bash
npm run check
npm run slophammer
```

Optional manual mutation testing remains available with `npm run mutate`.
