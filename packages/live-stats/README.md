# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics. It replaces Pi's default
spinner with the dots5 animation and shows the metrics for the current run in the theme's bold
warning color, with a lighter band that travels through the text from right to left.

```text
⠋ Working… (12s · ~438 out · 21.7 tok/s)
```

The frames are the `dots5` spinner from
[sindresorhus/cli-spinners](https://github.com/sindresorhus/cli-spinners), at 80 ms per frame. Each
frame is one terminal column wide, so the working line does not shift. The line holds no emoji and
no Turkish phrase. Pi supplies the single separating space after the indicator.

The shimmer enters from the right edge, crosses the line to the left, and leaves through the left
edge, so the line starts and ends each sweep in the plain warning color. The sweep takes 4.2
seconds, then the line rests in the plain color for 1.4 seconds before the next sweep. The colors
are stops between the theme's warning color and a lighter tint of it, so the sweep keeps the theme's
hue and stays orange instead of turning white.

A truecolor theme supplies the base color as an RGB triple. A 256-color theme supplies it as a
palette index; the extension blends the color in RGB and maps only the lighter stops back to the
nearest palette indices, so the base stop keeps the exact color the theme names. That palette is
coarse, so a 256-color theme gets fewer distinct stops than a truecolor theme. A theme that reports
no usable warning escape keeps the whole line in the warning color, with no sweep.

The extension reads the theme again on every render. Pi has no theme-change event, so the spinner
frames are re-applied when the theme's warning escape changes, which keeps the spinner and the
message in the same colors after a theme switch.

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
