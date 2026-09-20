# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics. It replaces Pi's default
spinner with the dots5 animation and shows the metrics for the current run in the theme's bold
warning color, with a lighter band that travels through the text.

```text
⠋ Working… (12s · ~438 out · 21.7 tok/s)
```

The frames are the `dots5` spinner from
[sindresorhus/cli-spinners](https://github.com/sindresorhus/cli-spinners), at 80 ms per frame. Each
frame is one terminal column wide, so the working line does not shift. The line holds no emoji and
no Turkish phrase. Pi supplies the single separating space after the indicator.

The shimmer sweeps a band of lighter color from left to right once every 1.4 seconds. The colors
are stops between the theme's warning color and white, so the sweep keeps the theme's hue. A theme
in 256-color mode falls back to two theme colors, because those escapes cannot be blended.

The timer covers one agent run, including model responses and tool calls. Output tokens accumulate
across the model responses in that run. Throughput is the estimated output generated during the
last five seconds, so it falls toward zero while Pi waits for a tool. Throughput shows one decimal
below 100 tok/s and a whole number at 100 tok/s and above.

Most providers report exact output usage only after a response finishes. While a response is
streaming, the extension estimates tokens with Pi's four-characters-per-token heuristic and prefixes
the count with `~`. The count is reconciled with the provider's reported usage when the response
ends.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/live-stats
```

```text
/reload
```

The extension applies automatically in interactive Pi sessions. It keeps Pi's existing interrupt
behavior.
