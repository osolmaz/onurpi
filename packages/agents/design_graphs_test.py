"""Run with: python3 -m unittest discover -s packages/agents -p '*_test.py'."""
import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import matplotlib
matplotlib.use("Agg")
from matplotlib import font_manager, pyplot as plt
from PIL import Image

SCRIPT = Path(__file__).parent / "skills/design/examples/graphs-figures/render_comparison_chart.py"
SPEC = importlib.util.spec_from_file_location("comparison", SCRIPT)
chart = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(chart)


class ComparisonChartTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        # An explicit test font avoids requiring proprietary fonts in CI.
        self.font = Path(font_manager.findfont("DejaVu Sans", fallback_to_default=False))

    def tearDown(self):
        plt.close("all")
        self.directory.cleanup()

    def render(self, background="dark", **kwargs):
        svg = self.root / f"{background}.svg"
        png = self.root / f"{background}.png"
        figure = chart.render(copy.deepcopy(chart.DEFAULT_DATA), svg, png, background,
                              font_file=self.font, **kwargs)
        return figure, svg, png

    def test_theme_and_exact_labels(self):
        figure, svg, png = self.render(example=True)
        self.assertTrue(svg.read_text().startswith("<?xml"))
        self.assertEqual(Image.open(png).getpixel((0, 0)), (0, 0, 0, 255))
        labels = [text.get_text() for axis in figure.axes for text in axis.texts]
        self.assertIn("402.6", labels)
        self.assertIn("145.3", labels)
        self.assertIn("0.706", labels)
        self.assertTrue(any("Illustrative data" in text.get_text() for text in figure.texts))
        ratios = [axis.get_position().width * figure.get_figwidth() /
                  (axis.get_position().height * figure.get_figheight()) for axis in figure.axes]
        self.assertLess(max(ratios) - min(ratios), 1e-9)
        self.assertFalse(any(text.get_fontweight() == "bold" for axis in figure.axes for text in axis.texts))

    def test_legends_match_neutral_fills_and_hatches(self):
        figure, _, _ = self.render()
        for axis_index, hatches in ((2, [None, "///"]), (4, ["///", None])):
            handles = figure.axes[axis_index].get_legend().legend_handles
            self.assertEqual([handle.get_hatch() for handle in handles], hatches)
            for handle in handles:
                red, green, blue, _ = handle.get_facecolor()
                self.assertEqual(red, green)
                self.assertEqual(green, blue)

    def test_light_is_opaque_beige_and_rounding_is_optional(self):
        _, _, png = self.render("light")
        self.assertEqual(Image.open(png).getpixel((0, 0)), (245, 240, 230, 255))
        _, _, rounded = self.render("dark", rounded=True)
        self.assertEqual(Image.open(rounded).getpixel((0, 0))[3], 0)

    def test_all_missing_rates_are_not_fabricated(self):
        data = copy.deepcopy(chart.DEFAULT_DATA)
        for model in data["models"]:
            model["precision"] = None
        figure = chart.render(data, self.root / "missing.svg", self.root / "missing.png",
                              "dark", font_file=self.font)
        self.assertEqual([text.get_text() for text in figure.axes[0].texts].count("n/a"), 3)

    def test_invalid_values_are_rejected(self):
        for value in (-1, float("nan"), float("inf"), True, "12"):
            with self.subTest(value=value):
                data = copy.deepcopy(chart.DEFAULT_DATA)
                data["models"][0]["concurrency"] = value
                with self.assertRaises(ValueError):
                    chart.validate_data(data)
        for data in ({}, {"models": []}, {"models": [{}]}):
            with self.assertRaises(ValueError):
                chart.validate_data(data)

    def test_existing_outputs_are_preserved(self):
        _, svg, png = self.render()
        before = (svg.read_bytes(), png.read_bytes())
        with self.assertRaises(ValueError):
            self.render()
        self.assertEqual(before, (svg.read_bytes(), png.read_bytes()))

    def test_no_silent_font_substitution(self):
        with patch.object(font_manager, "findfont", side_effect=ValueError("Unavailable")):
            with self.assertRaisesRegex(ValueError, "provide --font-file"):
                chart.select_font(None)


if __name__ == "__main__":
    unittest.main()
