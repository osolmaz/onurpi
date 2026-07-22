# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics and Turkish working messages. It picks a phrase when Pi starts working and shows the complete line in the theme's bold warning color. Pi's default spinner is replaced by the `weather` variant from [`cli-spinners`](https://github.com/sindresorhus/cli-spinners), running at 100 ms per frame.

```text
🌤  Yardırıyorum… (12s · ~438 out · 21.7 tok/s)
```

The spinner moves from sun through clouds, rain, snow, and thunder before clearing again. Every symbol is forced into emoji presentation and padded to the same three-column terminal width, so the working message does not shift between frames. The phrase stays fixed while Pi works, including automatic retries. The phrase changes after the agent settles. The timer covers one agent run, including model responses and tool calls. Output tokens accumulate across the model responses in that run. Throughput is the estimated output generated during the last five seconds, so it falls toward zero while Pi waits for a tool.

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
