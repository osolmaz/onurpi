# @onurpi/turn-fold

Turn-level transcript folding for the Pi coding agent.

`@onurpi/turn-fold` keeps only the latest three visible activity rows while Pi is working and
compresses earlier activity into one updating summary. When the turn completes, it keeps the final
assistant response visible and replaces intermediate assistant messages and tool rows with one
compact summary. The underlying session messages are not changed and remain in model context.

## Modes

| Mode         | Behavior                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| `live`       | Shows one working summary and the latest three activity rows, then folds. |
| `final-only` | Shows one live activity row, followed by the summary and final response.  |
| `expanded`   | Shows the complete transcript.                                            |

`live` is the default.

A folded row looks like:

```text
▶ Worked for 14s · 438 out · 8 tools · 2 msgs · Ctrl+Shift+O
```

The output count covers every assistant response in the turn, including responses that call tools.
Turn-fold uses provider-reported output usage when available. If a provider omits usage, turn-fold
estimates the missing response from its finalized content and prefixes the combined count with `~`.
It derives this information from existing session messages and does not store a separate metrics
record.

Turn-fold keeps the three newest settled turns in the transcript. Older assistant and tool activity
is replaced with one history row above them:

```text
▶ 5 previous turns · 12 msgs · ~1.3K out · 8 tools · Ctrl+Shift+O
```

The row counts completed assistant responses, output tokens, and tool calls across the collapsed
turns. Tool rows use zero horizontal padding so they align with an `outputPad: 0` transcript. Each
user prompt starts a turn. User prompts remain visible so the retained responses keep
their request context. Use `Ctrl+Shift+O` or `/turn-fold expanded` to show every row.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/turn-fold/index.ts
```

The package is private and is not published yet.

## Controls

```text
/turn-fold                         open the mode picker
/turn-fold live                    show the latest three activity rows, then fold
/turn-fold final-only              hide intermediate activity while running
/turn-fold expanded                show complete turns
/turn-fold toggle                  toggle the compact mode and expanded mode
/turn-fold status                  show the current mode
```

`Ctrl+Shift+O` toggles between the current compact mode and expanded mode. `Ctrl+O` remains Pi's
separate tool-output detail toggle.

Mode changes are stored as custom session entries, so each session restores its latest choice.
Historical turns are reconstructed from the active session branch when Pi starts or reloads.

## Current implementation boundary

Pi does not expose a public whole-turn transcript renderer. This extension uses Pi's exported
assistant and tool component classes but patches their rendering methods. It targets Pi 0.80.10 or
newer and must be retested when Pi changes its interactive transcript components.

Pi's public TUI API is keyboard-focused and does not provide inline mouse-click handlers for
transcript rows. The mode picker and shortcut provide expansion without pretending the summary row
is clickable.

## Quality checks

```bash
npm run check
npm run mutate
npm run slophammer
```
