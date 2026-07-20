# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics and Turkish working messages. It picks a phrase when Pi starts working and shows the complete message in bold.

```text
⠋ Yardırıyorum… (12s · ~438 out · 21.7 tok/s)
```

The phrase stays fixed while Pi works, including automatic retries, and changes after the agent settles. The timer covers one agent run, including model responses and tool calls. Output tokens accumulate across the model responses in that run. Throughput is the estimated output generated during the last five seconds, so it falls toward zero while Pi waits for a tool.

Most providers report exact output usage only after a response finishes. While a response is streaming, the extension estimates tokens with Pi's four-characters-per-token heuristic and prefixes the count with `~`. The count is reconciled with the provider's reported usage when the response ends.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/live-stats
```

```text
/reload
```

The extension applies automatically in interactive Pi sessions. It keeps Pi's existing spinner and interrupt behavior.
