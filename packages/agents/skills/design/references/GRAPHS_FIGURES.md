# Graphs and figures

Create figures from actual source values and inspect the exported image. Apply
the [shared theme](THEME.md). Figures use Yodel Grotesk; figures within an
existing page match that page.

## Data and meaning

Keep the source values unchanged and document display rounding. State units,
denominators, sampling conditions, and available uncertainty. Label estimates
and probes. Never fill missing observations with invented numbers.

Separate incompatible metrics. Distinguish single-worker throughput from aggregate throughput. Define wall-clock
throughput and token accounting separately. Use one metric per panel
when the quantities need different scales. Name any scale differences in the
figure caption. Do not infer a ranking from a small or inconclusive sample.

Use zero baselines for ordinary bar charts. Disclose a justified alternative
scale and make its meaning clear. Include negative values honestly when present.
Keep model or series order consistent across panels and specify panel order in
source code. Show units in titles, axis labels, or legends.

A maximum value is not automatically a winner. Parameter count and concurrency
are descriptive properties. Use `practical-significance` before a measured lead
supports spending or shipping. Do not let automatic highlighting make that
decision. Preserve regressions and uncertainty.

## Drawing and layout

Use a plotting library such as matplotlib, Plotly, or Altair. Export SVG and PNG
directly when practical. Do not hand-build ordinary SVG chart geometry or route
normal export through ImageMagick or Inkscape.

Use neutral fills with outlines, hatching, line styles, or markers to distinguish
series. Put exact labels near marks when readable. Add semantic color only when
needed, with another way to identify the same meaning. Keep source-product
series colors when fidelity requires them. Explain semantic color exceptions.

Keep model names visible and omit redundant axis titles. Put useful labels above
bars without collisions. Ordinary bars start at zero. For nonnegative unbounded
values, `ymax = max_value / 0.9` is a useful initial bound; adjust it for label
space and use appropriate bounds for other data types. Do not hide the scale
when direct labels cannot explain it.

Preserve physical panel dimensions when changing row layout. Center incomplete
rows. Set bar widths deliberately and provide enough panel gaps and edge padding. Size the canvas
to its content so an earlier layout does not leave large empty gutters.

Use square bars and plain backgrounds by default. Rounded bar tops are optional;
when requested, their radii must be circular in display pixels. For rounded outer
containers, use physical units so the radius does not stretch with aspect ratio.
If the outside corners are transparent, keep the chart interior opaque. Avoid
`savefig(..., transparent=True)` when it also clears the axes patches.

## Export and review

Keep an editable source with its input data. Record output dimensions and font evidence. Export
SVG and PNG when practical, then open the PNG. Check labels, units, mark heights,
overlap, clipping, whitespace, and consistent ordering. Check at the intended
reading size. Verify panel dimensions numerically when geometry matters.

For transparent-corner figures, sample pixels to confirm alpha zero outside the
container and the intended colors inside it. Otherwise verify an opaque canvas
with the correct target background. Inspect the final export after the last edit.

## Comparison example

The bundled `examples/graphs-figures/render_comparison_chart.py` is a starting
point for one particular five-panel comparison, with a centered 3-over-2 layout.
It is not a general data schema or a required layout. CI tests it with Python 3.12
and matplotlib 3.10.3. Use a compatible matplotlib release for other Python
versions; matplotlib 3.10.3 fails on Python 3.14 during path copying. Resolve the path from
`DESIGN_DIR`, the directory containing the loaded `SKILL.md`.

```sh
python3 "$DESIGN_DIR/examples/graphs-figures/render_comparison_chart.py" \
  metrics.json --out chart.svg --png chart.png
```

The example defaults to dark mode and requires a data file. Use `--example`
explicitly for illustrative data, `--background light` for beige, or a concrete
hex color to match a target page. The helper uses an installed Yodel Grotesk or
an authorized font file passed with `--font-file`, and stops when neither is
available. It reports its actual font and refuses to replace outputs.
Keep example figures clearly labeled and never present them as measured results.
