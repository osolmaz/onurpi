# @onurpi/live-stats

`@onurpi/live-stats` is a Pi extension for live response metrics. It replaces Pi's default spinner
with a two-cell braille animation and shows the metrics for the current run in the theme's warning
color, with a lighter band that travels through the text from right to left.

```text
⡇⠀ Working (12s · ~438 out · 21.7 tok/s)
```

Only the label is bold. The statistics in parentheses keep the normal weight, parentheses included.
The line holds no emoji and no Turkish phrase. Pi supplies the single separating space after the
indicator.

Pi picks one spinner at random when a session starts and keeps it for that whole session, so a
conversation always shows the same animation. The set holds twenty-one animations, each with its own
frame count and timing. Every frame is exactly two code points from the braille block
(U+2800..U+28FF), so a frame covers two terminal columns and the line never changes width. The
animations are defined in [`spinners.ts`](spinners.ts).

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

## Spinner viewer

[`viewer.html`](viewer.html) is a self-contained page that runs every animation side by side, shows
the selected spinner large with its dot grid, and copies the frames as Pi indicator options. It
opens straight from the file system. Rebuild it after a change to the spinner set:

```bash
npm run viewer --workspace @onurpi/live-stats
```

A test compares the committed page with the current spinner set, so rebuild the page in the same
change. The page carries its own frame data and its own braille decoder.

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
