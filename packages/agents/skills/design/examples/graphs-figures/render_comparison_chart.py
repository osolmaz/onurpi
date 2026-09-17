#!/usr/bin/env python3
"""Example renderer for a polished multi-panel comparison chart.

Usage:

    python render_comparison_chart.py metrics.json --out chart.svg --png chart.png
    python render_comparison_chart.py --example --background light --out chart.svg --png chart.png

Defaults follow references/THEME.md in the design skill: black dark mode,
beige light mode, and Helvetica with a reported fallback. Sample data require
--example. Supply --font-file for an authorized film font. Outputs are new files.
"""

import argparse
import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.path import Path as MplPath
from matplotlib.patches import Patch, PathPatch, Rectangle


DEFAULT_DATA = {
    "models": [
        {
            "id": "gemma",
            "label": "Example A",
            "precision": 0.706,
            "recall": 0.904,
            "single_worker_output_tokens_per_second": 25.0,
            "aggregate_output_tokens_per_second": 402.6,
            "concurrency": 16,
            "total_parameters_b": 26,
            "active_parameters_b": 4,
        },
        {
            "id": "qwen",
            "label": "Example B",
            "precision": 0.834,
            "recall": 0.812,
            "single_worker_output_tokens_per_second": 50.0,
            "aggregate_output_tokens_per_second": 145.3,
            "concurrency": 4,
            "total_parameters_b": 35,
            "active_parameters_b": 3,
        },
        {
            "id": "deepseek",
            "label": "Example C",
            "precision": 0.938,
            "recall": 0.714,
            "single_worker_output_tokens_per_second": 13.0,
            "aggregate_output_tokens_per_second": 13.0,
            "concurrency": 1,
            "total_parameters_b": 284,
            "active_parameters_b": 13,
        },
    ]
}


PANEL_METRICS = [
    ("Precision", "precision", "higher is better", "{:g}"),
    ("Recall", "recall", "higher is better", "{:g}"),
]

GROUP_STEP = 0.8
SIDE_PADDING = 0.55
SINGLE_BAR_WIDTH = 0.50
GROUPED_BAR_WIDTH = 0.22


def hex_to_rgb(color):
    value = color.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Expected a 6-digit hex color, got {color!r}")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#" + "".join(f"{max(0, min(255, int(round(channel)))):02x}" for channel in rgb)


def mix(color, target, amount):
    base_rgb = hex_to_rgb(color)
    target_rgb = hex_to_rgb(target)
    return rgb_to_hex(tuple(base + (target - base) * amount for base, target in zip(base_rgb, target_rgb)))


def luminance(color):
    channels = []
    for value in hex_to_rgb(color):
        channel = value / 255
        channels.append(channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def resolve_style(background):
    figure_background = {"dark": "#000000", "light": "#F5F0E6"}.get(background, background)
    is_dark = luminance(figure_background) < 0.35
    return {
        "rounded_block": False,
        "figure_background": figure_background,
        "panel_background": figure_background,
        "panel_border": "#888888" if is_dark else "#666666",
        "grid": mix(figure_background, "#ffffff" if is_dark else "#000000", 0.16),
        "text": "#F5F5F5" if is_dark else "#111111",
        "muted_text": "#BDBDBD" if is_dark else "#4A4A4A",
        "highlight": "#BDBDBD" if is_dark else "#4A4A4A",
        "secondary": "#888888" if is_dark else "#767676",
        "neutral": "#BDBDBD" if is_dark else "#4A4A4A",
    }


def model_positions(models):
    return [i * GROUP_STEP for i in range(len(models))]


def set_model_axis(ax, positions, names):
    ax.set_xlim(positions[0] - SIDE_PADDING, positions[-1] + SIDE_PADDING)
    ax.set_xticks(positions)
    ax.set_xticklabels(names)


def max_axis_value(values):
    return max(values) / 0.9 if values and max(values) else 1


def style_axis(ax, style):
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(axis="both", length=0, colors=style["muted_text"])
    ax.grid(axis="y", color=style["grid"], linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_facecolor(style["panel_background"])
    ax.patch.set_alpha(1)
    ax.add_patch(
        Rectangle(
            (0, 0),
            1,
            1,
            transform=ax.transAxes,
            fill=False,
            linewidth=0.8,
            edgecolor=style["panel_border"],
            clip_on=False,
            zorder=10,
        )
    )


def rounded_bar(ax, x, height, width, color, radius_px=0, hatch=None):
    left, bottom = ax.transData.transform((x - width / 2, 0))
    right, top = ax.transData.transform((x + width / 2, height))
    radius = min(radius_px, (right - left) / 2, (top - bottom) / 2)
    inv = ax.transData.inverted()

    points = [(left, bottom), (left, top - radius)]
    points.extend(
        (
            left + radius + radius * math.cos(angle),
            top - radius + radius * math.sin(angle),
        )
        for angle in [math.pi - i * (math.pi / 2) / 8 for i in range(9)]
    )
    points.append((right - radius, top))
    points.extend(
        (
            right - radius + radius * math.cos(angle),
            top - radius + radius * math.sin(angle),
        )
        for angle in [math.pi / 2 - i * (math.pi / 2) / 8 for i in range(9)]
    )
    points.extend([(right, bottom), (left, bottom)])

    data_points = inv.transform(points)
    codes = [MplPath.MOVETO] + [MplPath.LINETO] * (len(data_points) - 2) + [MplPath.CLOSEPOLY]
    patch = PathPatch(MplPath(data_points, codes), linewidth=0.7, facecolor=color,
                      edgecolor=ax.get_facecolor(), hatch=hatch, clip_on=True)
    ax.add_patch(patch)
    return patch


def add_rounded_figure_background(fig, style, radius_in=0.22):
    fig_width, fig_height = fig.get_size_inches()
    rx = radius_in / fig_width
    ry = radius_in / fig_height
    points = [(rx, 0), (1 - rx, 0)]
    points.extend((1 - rx + rx * math.cos(a), ry + ry * math.sin(a)) for a in [-math.pi / 2 + i * (math.pi / 2) / 12 for i in range(13)])
    points.append((1, 1 - ry))
    points.extend((1 - rx + rx * math.cos(a), 1 - ry + ry * math.sin(a)) for a in [i * (math.pi / 2) / 12 for i in range(13)])
    points.append((rx, 1))
    points.extend((rx + rx * math.cos(a), 1 - ry + ry * math.sin(a)) for a in [math.pi / 2 + i * (math.pi / 2) / 12 for i in range(13)])
    points.append((0, ry))
    points.extend((rx + rx * math.cos(a), ry + ry * math.sin(a)) for a in [math.pi + i * (math.pi / 2) / 12 for i in range(13)])
    points.append((rx, 0))

    codes = [MplPath.MOVETO] + [MplPath.LINETO] * (len(points) - 2) + [MplPath.CLOSEPOLY]
    fig.add_artist(
        PathPatch(
            MplPath(points, codes),
            transform=fig.transFigure,
            linewidth=0,
            facecolor=style["figure_background"],
            edgecolor="none",
            clip_on=False,
            zorder=-20,
        )
    )


def annotate_value(ax, x, value, text, style, is_best=False):
    ax.annotate(
        text,
        xy=(x, value),
        xytext=(0, 4),
        textcoords="offset points",
        ha="center",
        va="bottom",
        fontsize=8,
        fontweight="bold" if is_best else "normal",
        color=style["text"],
    )


def render_metric_panel(ax, models, names, title, key, direction_label, value_format, style):
    positions = model_positions(models)
    values = [model[key] for model in models]
    finite_values = [value for value in values if value is not None]

    set_model_axis(ax, positions, names)
    ax.set_title(title, loc="left", pad=10, color=style["text"])
    ax.text(1.0, 1.06, direction_label, transform=ax.transAxes, ha="right", va="bottom", fontsize=7.5, color=style["muted_text"])
    ymax = max_axis_value(finite_values)
    ax.set_ylim(0, ymax)
    ax.set_yticks([0, ymax])
    ax.set_yticklabels(["0", ""])
    style_axis(ax, style)

    for x, value in zip(positions, values):
        if value is None:
            annotate_value(ax, x, 0, "n/a", style)
            continue
        rounded_bar(ax, x, value, SINGLE_BAR_WIDTH, style["neutral"])
        annotate_value(ax, x, value, value_format.format(value), style)


def render_throughput_panel(ax, models, names, style):
    group_x = model_positions(models)
    width = GROUPED_BAR_WIDTH
    single_values = [model["single_worker_output_tokens_per_second"] for model in models]
    aggregate_values = [model["aggregate_output_tokens_per_second"] for model in models]
    single_x = [x - width / 2 for x in group_x]
    aggregate_x = [x + width / 2 for x in group_x]

    ax.set_title("Output tok/s", loc="left", pad=10, color=style["text"])
    ax.text(1.0, 1.06, "higher is better", transform=ax.transAxes, ha="right", va="bottom", fontsize=7.5, color=style["muted_text"])
    set_model_axis(ax, group_x, names)
    ymax = max_axis_value(single_values + aggregate_values)
    ax.set_ylim(0, ymax)
    ax.set_yticks([0, ymax])
    ax.set_yticklabels(["0", ""])
    style_axis(ax, style)

    for x, value in zip(single_x, single_values):
        rounded_bar(ax, x, value, width, style["secondary"], hatch="///")
        annotate_value(ax, x, value, f"{value:g}", style)
    for x, value in zip(aggregate_x, aggregate_values):
        rounded_bar(ax, x, value, width, style["highlight"])
        annotate_value(ax, x, value, f"{value:g}", style)

    handles = [
        Patch(facecolor=style["secondary"], edgecolor=style["panel_background"], hatch="///", label="Per single worker"),
        Patch(facecolor=style["highlight"], edgecolor=style["panel_background"], label="Aggregate"),
    ]
    legend = ax.legend(handles=handles, loc="upper right", frameon=False, fontsize=7.2, ncols=1, handlelength=1.2)
    for text in legend.get_texts():
        text.set_color(style["muted_text"])


def render_single_bar_panel(ax, models, names, title, key, style, value_format="{:g}"):
    positions = model_positions(models)
    values = [model[key] for model in models]
    set_model_axis(ax, positions, names)
    ax.set_title(title, loc="left", pad=10, color=style["text"])
    ymax = max_axis_value(values)
    ax.set_ylim(0, ymax)
    ax.set_yticks([0, ymax])
    ax.set_yticklabels(["0", ""])
    style_axis(ax, style)

    for x, value in zip(positions, values):
        rounded_bar(ax, x, value, SINGLE_BAR_WIDTH, style["neutral"])
        annotate_value(ax, x, value, value_format.format(value), style)


def render_parameter_panel(ax, models, names, style):
    group_x = model_positions(models)
    width = GROUPED_BAR_WIDTH
    total_values = [model["total_parameters_b"] for model in models]
    active_values = [model["active_parameters_b"] for model in models]
    total_x = [x - width / 2 for x in group_x]
    active_x = [x + width / 2 for x in group_x]

    ax.set_title("Parameters", loc="left", pad=10, color=style["text"])
    set_model_axis(ax, group_x, names)
    ymax = max_axis_value(total_values + active_values)
    ax.set_ylim(0, ymax)
    ax.set_yticks([0, ymax])
    ax.set_yticklabels(["0", ""])
    style_axis(ax, style)

    for x, value in zip(total_x, total_values):
        rounded_bar(ax, x, value, width, style["highlight"])
        annotate_value(ax, x, value, f"{value:g}B", style)
    for x, value in zip(active_x, active_values):
        rounded_bar(ax, x, value, width, style["secondary"], hatch="///")
        annotate_value(ax, x, value, f"{value:g}B", style)

    handles = [
        Patch(facecolor=style["highlight"], edgecolor=style["panel_background"], label="Total"),
        Patch(facecolor=style["secondary"], edgecolor=style["panel_background"], hatch="///", label="Active"),
    ]
    legend = ax.legend(handles=handles, loc="upper left", frameon=False, fontsize=7.5, ncols=2, handlelength=1.2, columnspacing=0.8)
    for text in legend.get_texts():
        text.set_color(style["muted_text"])


def create_axes(fig):
    fig_width, fig_height = fig.get_size_inches()
    panel_width = 2.754807692307692
    panel_height = 2.88
    panel_gap = 0.50
    row_gap = 0.86
    bottom_margin = 0.55

    def add_axis(left_in, bottom_in):
        return fig.add_axes([left_in / fig_width, bottom_in / fig_height, panel_width / fig_width, panel_height / fig_height])

    top_width = panel_width * 3 + panel_gap * 2
    bottom_width = panel_width * 2 + panel_gap
    top_left = (fig_width - top_width) / 2
    bottom_left = (fig_width - bottom_width) / 2
    bottom_y = bottom_margin
    top_y = bottom_y + panel_height + row_gap
    return [
        add_axis(top_left, top_y),
        add_axis(top_left + panel_width + panel_gap, top_y),
        add_axis(top_left + (panel_width + panel_gap) * 2, top_y),
        add_axis(bottom_left, bottom_y),
        add_axis(bottom_left + panel_width + panel_gap, bottom_y),
    ]


def render(data, out_path, png_path, background, font_file=None, rounded=False, example=False):
    models = data["models"]
    names = [model["label"] for model in models]
    validate_data(data)
    style = resolve_style(background)
    style["rounded_block"] = rounded
    font_name = select_font(font_file)
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": [font_name],
            "axes.titleweight": "bold",
            "axes.titlesize": 11,
            "xtick.labelsize": 7.5,
            "ytick.labelsize": 7.5,
            "svg.fonttype": "none",
        }
    )

    panel_width = 2.754807692307692
    panel_height = 2.88
    panel_gap = 0.50
    row_gap = 0.86
    bottom_margin = 0.55
    side_margin = 0.55 if style["rounded_block"] else 0.70
    top_margin = 0.60
    fig_width = panel_width * 3 + panel_gap * 2 + side_margin * 2
    fig_height = bottom_margin + panel_height * 2 + row_gap + top_margin
    fig = plt.figure(figsize=(fig_width, fig_height), constrained_layout=False)
    fig.patch.set_facecolor(style["figure_background"])
    if style["rounded_block"]:
        fig.patch.set_alpha(0)
        add_rounded_figure_background(fig, style)
    caption = "Illustrative data; not measured results. " if example else ""
    fig.text(0.5, 0.01, caption + "Panels use different y-scales.", ha="center", color=style["text"])
    axes = create_axes(fig)

    for ax, metric in zip(axes[:2], PANEL_METRICS):
        render_metric_panel(ax, models, names, *metric, style)
    render_parameter_panel(axes[2], models, names, style)
    render_single_bar_panel(axes[3], models, names, "Concurrency", "concurrency", style)
    render_throughput_panel(axes[4], models, names, style)

    if out_path.resolve() == png_path.resolve() or out_path.exists() or png_path.exists():
        raise ValueError("Output paths must be distinct new files")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    png_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("xb") as svg:
        fig.savefig(svg, format="svg")
    with png_path.open("xb") as png:
        fig.savefig(png, format="png", dpi=180)
    return fig


def select_font(font_file):
    if font_file is not None:
        font_manager.fontManager.addfont(str(font_file))
        name = font_manager.FontProperties(fname=font_file).get_name()
        # Put the authorized file first, including when another version is installed.
        font_manager.fontManager.ttflist.insert(0, font_manager.fontManager.ttflist.pop())
        print(f"Font: {name} ({font_file})")
        return name
    for name in ["Helvetica", "Arial", "Liberation Sans"]:
        try:
            selected = font_manager.findfont(name, fallback_to_default=False)
        except ValueError:
            continue
        print(f"Font: {name} ({selected})" + ("; documented Helvetica fallback" if name != "Helvetica" else ""))
        return name
    raise ValueError("Helvetica and documented fallbacks are unavailable; provide --font-file")


def validate_data(data):
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list) or not models:
        raise ValueError("Expected a nonempty models list")
    keys = list(DEFAULT_DATA["models"][0].keys())
    for model in models:
        if not isinstance(model, dict) or not isinstance(model.get("label"), str) or not model["label"].strip():
            raise ValueError("Each model needs a label")
        for key in keys:
            if key in ("id", "label"):
                continue
            value = model.get(key)
            if value is None and key in ("precision", "recall"):
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"This example needs a finite nonnegative {key}")
            if key in ("precision", "recall") and value > 1:
                raise ValueError(f"{key} must be between 0 and 1")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data", nargs="?", type=Path, help="JSON data file")
    parser.add_argument("--example", action="store_true", help="Use clearly marked illustrative data")
    parser.add_argument("--font-file", type=Path, help="Authorized font file, for example for a film")
    parser.add_argument("--rounded", action="store_true", help="Optional rounded container with transparent corners")
    parser.add_argument("--background", default="dark", help='Target background: "light", "dark", or a six-digit hex color.')
    parser.add_argument("--out", type=Path, default=Path("comparison-chart.svg"))
    parser.add_argument("--png", type=Path, default=Path("comparison-chart.png"))
    args = parser.parse_args()

    if (args.data is None) == (not args.example):
        parser.error("Supply a data file or --example, but not both")
    data = json.loads(args.data.read_text()) if args.data else DEFAULT_DATA
    fig = render(data, args.out, args.png, args.background, args.font_file, args.rounded, args.example)

    for i, ax in enumerate(fig.axes, start=1):
        bbox = ax.get_position()
        width_in = bbox.width * fig.get_figwidth()
        height_in = bbox.height * fig.get_figheight()
        print(f"panel {i}: {width_in:.3f}in x {height_in:.3f}in ratio={width_in / height_in:.3f}")
    print(args.out)
    print(args.png)


if __name__ == "__main__":
    main()
