# @onurpi/turn-fold

Compact transcript rendering for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a
run. Earlier activity is replaced by one summary row. When the run stops, tool rows and intermediate
assistant messages disappear. The final response stays visible with a `Worked for …` line beneath
it. If the run is interrupted, the last partial response or activity row stays above that line.

The extension changes only the display. Pi keeps every underlying session message in model context.

## Modes

| Mode       | Behavior                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| `compact`  | Shows a summary and the latest three rows, then the final row and elapsed time. |
| `expanded` | Shows the complete transcript.                                                  |

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
/turn-fold status           show the current mode
```

`Ctrl+Shift+O` switches between compact and expanded rendering. `Ctrl+O` remains Pi's separate
tool-output detail toggle.

Mode changes are stored as custom session entries, so each session restores its latest supported
choice. Historical turns are reconstructed from the active session branch when Pi starts or
reloads. Older `live` and `final-only` values are no longer modes and resolve to the compact default.

## Current implementation boundary

Pi does not expose a public whole-turn transcript renderer. This extension uses Pi's exported
assistant and tool component classes but patches their rendering methods. It targets Pi 0.80.10 or
newer and must be retested when Pi changes its interactive transcript components.

## Quality checks

```bash
npm run check
npm run mutate
npm run slophammer
```
