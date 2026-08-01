import { describe, expect, it, vi } from "vitest";

import { HistoryViewer, historyEntryText, historyPages } from "./history-viewer.ts";

function assistant(id: string, text: string): unknown {
  return {
    id,
    message: {
      content: [{ text, type: "text" }],
      role: "assistant",
      timestamp: 1,
    },
    type: "message",
  };
}

describe("Turn Fold history viewer", () => {
  it("formats transcript roles and escapes terminal controls", () => {
    expect(historyEntryText(assistant("answer", "safe\u001b[31m"))).toBe(
      "assistant answer\nsafe\\x1b[31m",
    );
  });

  it("bounds individual entry text", () => {
    const rendered = historyEntryText(assistant("large", "x".repeat(10_000)));

    expect(rendered.length).toBeLessThan(2_100);
    expect(rendered.endsWith("\n…")).toBe(true);
  });

  it("moves between pages and closes without accumulating page components", () => {
    const requestRender = vi.fn();
    const close = vi.fn();
    const viewer = new HistoryViewer(
      [["first"], ["second"]],
      (text) => text,
      (text) => text,
      requestRender,
      close,
    );

    expect(viewer.render(80).join("\n")).toContain("first");
    viewer.handleInput("l");
    expect(viewer.render(80).join("\n")).toContain("second");
    expect(requestRender).toHaveBeenCalledOnce();
    viewer.handleInput("q");
    expect(close).toHaveBeenCalledOnce();
  });

  it("paginates without retaining an unbounded active page", () => {
    const entries = Array.from({ length: 41 }, (_, index) =>
      assistant(`answer-${String(index)}`, `Text ${String(index)}`),
    );

    const pages = historyPages(entries);

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.length)).toEqual([20, 20, 1]);
  });
});
