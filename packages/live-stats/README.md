# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics and Turkish working messages. It picks a phrase when Pi starts working and shows the complete line in the theme's bold warning color. Pi's default spinner is replaced by a randomly selected single-emoji animation. Most variants come from [`cli-spinners`](https://github.com/sindresorhus/cli-spinners), alongside custom man and woman lifecycle animations.

```text
🌤️ Yardırıyorum… (12s · ~438 out · 21.7 tok/s)
```

The curated collection includes weather, moon phases, clocks, globes, monkeys, runners, hand gestures, speaker volume, and birth-to-reincarnation life cycles. Basic color and shape pulses are omitted. One variant is selected when the session starts and keeps its configured animation interval. Every frame contains one emoji at the same two-column terminal width with no embedded spacing, so the working message does not shift. Pi supplies the single separating space after the spinner. The phrase stays fixed while Pi works, including automatic retries. The phrase changes after the agent settles. The timer covers one agent run, including model responses and tool calls. Output tokens accumulate across the model responses in that run. Throughput is the estimated output generated during the last five seconds, so it falls toward zero while Pi waits for a tool.

Most providers report exact output usage only after a response finishes. While a response is streaming, the extension estimates tokens with Pi's four-characters-per-token heuristic and prefixes the count with `~`. The count is reconciled with the provider's reported usage when the response ends.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/live-stats
```

```text
/reload
```

The extension applies automatically in interactive Pi sessions. It keeps Pi's existing interrupt behavior.
