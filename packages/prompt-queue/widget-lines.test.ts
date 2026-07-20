import { describe, expect, it } from "vitest";

import type { WidgetPalette } from "./widget-lines.ts";
import { previewText, widgetLines } from "./widget-lines.ts";

const plain: WidgetPalette = {
  accent: (text) => `A(${text})`,
  dim: (text) => `D(${text})`,
  warning: (text) => `W(${text})`,
};

describe("previewText", () => {
  it("keeps a short single-line prompt unchanged", () => {
    expect(previewText("short", 10)).toBe("short");
  });

  it("marks multiline prompts with a trailing ellipsis", () => {
    expect(previewText("first line\nsecond line", 40)).toBe("first line …");
  });

  it("trims whitespace around the first line", () => {
    expect(previewText("  hello  \nworld", 40)).toBe("hello …");
  });

  it("ignores trailing whitespace when deciding the ellipsis", () => {
    expect(previewText("hello   ", 40)).toBe("hello");
  });

  it("truncates long text with an ellipsis at the width limit", () => {
    const preview = previewText("x".repeat(80), 10);
    expect(preview).toBe(`${"x".repeat(9)}…`);
  });

  it("truncates at the default width when none is given", () => {
    const preview = previewText("y".repeat(100));
    expect(preview).toBe(`${"y".repeat(71)}…`);
    expect(previewText("y".repeat(72))).toBe("y".repeat(72));
  });
});

describe("widgetLines", () => {
  const open = { windowOpen: false, held: false };

  it("returns no lines when there is nothing to show", () => {
    expect(widgetLines([], open, plain)).toEqual([]);
  });

  it("labels queued and steer items with their position", () => {
    const lines = widgetLines(
      [
        { id: 1, mode: "queue", text: "first prompt" },
        { id: 2, mode: "steer", text: "second prompt" },
      ],
      open,
      plain,
    );
    expect(lines).toEqual([
      "D(1.) A(queued) first prompt",
      "D(2.) W(will steer) second prompt",
      "D(↑ manage queue)",
    ]);
  });

  it("collapses items beyond the cap into a summary line", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      mode: "queue" as const,
      text: `p${String(index + 1)}`,
    }));
    const lines = widgetLines(items, open, plain);
    expect(lines).toHaveLength(7);
    expect(lines[4]).toBe("D(5.) A(queued) p5");
    expect(lines[5]).toBe("D(… 2 more queued)");
  });

  it("shows a paused status while the manager window is open", () => {
    const lines = widgetLines([], { windowOpen: true, held: false }, plain);
    expect(lines).toEqual(["W(prompt queue paused)D( — press ↑ to manage)"]);
  });

  it("shows a paused status while delivery is held after an abort", () => {
    const lines = widgetLines(
      [{ id: 1, mode: "queue", text: "x" }],
      { windowOpen: false, held: true },
      plain,
    );
    expect(lines).toEqual(["D(1.) A(queued) x", "W(prompt queue paused)D( — press ↑ to manage)"]);
  });
});
