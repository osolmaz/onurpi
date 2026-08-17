---
name: plot-graph
description: Create polished SVG/PNG chart figures from experiment metrics, especially multi-panel bar charts for blog posts or reports. Use when asked to generate, revise, or verify a graph/plot/figure and visual correctness matters.
---

# Plot Graph

## Workflow

1. Use a plotting library.

- Prefer `matplotlib`, `plotly`, `altair`, or another real charting library.
- Do not hand-roll SVG geometry unless the chart itself requires custom vector logic.
- Do not use ImageMagick or Inkscape for normal chart export. Export SVG/PNG directly from the plotting library.

2. Choose the right metric before drawing.

- Do not mix incompatible metrics in one visual comparison.
- Separate single-worker throughput, aggregate throughput, wall-clock throughput, and token accounting.
- If a number is an estimate or probe result, label it as such in surrounding prose or the figure caption.
- If a metric is not comparable across models, either leave it out or use a separate panel with a clear label.

3. Make charts scannable.

- For multi-panel comparisons, keep one metric per panel.
- Use consistent model order across every panel.
- Keep the intended panel order explicit in source code. For example, if the narrative wants model-size context before throughput, place `Parameters` before `Output tok/s` rather than relying on whatever order the data file happens to use.
- Keep model names visible on the x-axis; do not add a redundant x-axis title.
- If every panel has a different y-scale, say so in the caption.
- Use a consistent highlight color for the best value in each panel and neutral gray for the others.
- Preserve units in titles or legends, for example `Output tok/s`, `Parameters`, `Concurrency`.

4. Choose the background deliberately.

- Before rendering, determine the target background. If the user has not specified one, ask whether they want `light`, `dark`, or a specific background color.
- For a specific background, accept a concrete color such as a hex value sampled from a reference page or brand asset.
- Keep the chart readable against that target: light backgrounds need dark text; dark backgrounds need light text.
- If using a dark chart block, make the main figure background match the target color, make the plot panels slightly lighter than the main background, and use muted-light grid/border colors.
- If the figure has rounded outer corners, make the outside corners transparent. Use display/physical units for the outer corner radius so corners stay circular rather than stretched by the figure aspect ratio.

5. Preserve geometry deliberately.

- If converting a one-row figure to a two-row figure, preserve the panel aspect ratio, not just the outer image dimensions.
- Use fixed physical panel dimensions when aspect ratio matters.
- Center incomplete rows instead of leaving them left-aligned.
- Add left/right padding inside each panel so edge bars do not touch the frame.
- Adjust spacing and bar width explicitly; do not rely on matplotlib defaults.
- Size the outer canvas to the chart content plus intentional margins. Do not leave large empty side gutters from an older wider layout.

6. Use robust visual details.

- Use rounded bar tops only if the corner radius is circular in display pixels. Data-unit rounding distorts with axis scaling.
- Keep the outer figure background transparent when the chart will sit in a page, but preserve the intended main chart block and plot panel backgrounds.
- Do not use `savefig(..., transparent=True)` if it makes axes patches transparent. Prefer `fig.patch.set_alpha(0)`, `ax.set_facecolor("#ffffff")`, `ax.patch.set_alpha(1)`, and normal `savefig(...)`.
- Add a thin border around each plot area if the surrounding page background may vary.
- Derive y-axis upper bounds programmatically from data. A good default for bar charts is `ymax = max_value / 0.9`, so the tallest bar reaches 90% of the plot height.
- Keep only the useful y-axis tick labels. Often `0` is enough when bars are directly labeled.
- Put values above bars, and check labels do not collide with legends or panel borders.

7. Verify the rendered output.

- Always render both SVG and PNG when practical.
- Inspect the PNG visually before calling the chart finished.
- Check for label overlap, clipped bars, distorted aspect ratios, excessive whitespace, missing model labels, and stretched outer rounded corners.
- For transparent-corner figures, sample pixels in the rendered PNG: outer corners should be alpha 0, the main chart rectangle should match the target background, and panel interiors should match the chosen panel color.
- If possible, verify panel dimensions numerically when the user cares about aspect ratio.

## Example Script

Use `examples/render_comparison_chart.py` as a starting point for blog-style multi-panel bar charts. It demonstrates:

- direct SVG/PNG export from matplotlib
- selectable light, dark, or custom target background
- transparent outer background outside an optional rounded chart block
- aspect-correct outer rounded corners
- bordered panels with theme-aware colors
- circular rounded bar tops
- data-derived y-limits with max bars at 90% height
- preserved panel aspect ratio in a 3-over-2 layout
- content-sized canvas with no stale side gutters
- visible x tick labels without redundant x-axis titles
- grouped bars for paired metrics such as per-worker and aggregate throughput
