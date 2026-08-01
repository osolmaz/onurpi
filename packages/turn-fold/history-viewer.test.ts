import { describe, expect, it, vi } from "vitest";

import {
  HistoryViewer,
  historyEntryText,
  historyPage,
  historyPageCount,
} from "./history-viewer.ts";

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
    const entries = Array.from({ length: 21 }, (_, index) =>
      assistant(`answer-${String(index)}`, `Text ${String(index)}`),
    );
    const viewer = new HistoryViewer(
      entries,
      (text) => text,
      (text) => text,
      requestRender,
      close,
    );

    expect(viewer.render(80).join("\n")).toContain("Text 0");
    expect(viewer.render(80).join("\n")).not.toContain("Text 20");
    viewer.handleInput("l");
    expect(viewer.render(80).join("\n")).toContain("Text 20");
    expect(requestRender).toHaveBeenCalledOnce();
    viewer.handleInput("q");
    expect(close).toHaveBeenCalledOnce();
  });

  it("formats only the current page when opening a large history", () => {
    const bodyReads = vi.fn();
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      id: `answer-${String(index)}`,
      message: {
        get content(): unknown {
          bodyReads();
          return [{ text: `Text ${String(index)}`, type: "text" }];
        },
        role: "assistant",
        timestamp: index,
      },
      type: "message",
    }));

    new HistoryViewer(
      entries,
      (text) => text,
      (text) => text,
      vi.fn(),
      vi.fn(),
    );

    expect(bodyReads).toHaveBeenCalledTimes(20);
  });

  it("paginates without retaining an unbounded active page", () => {
    const entries = Array.from({ length: 41 }, (_, index) =>
      assistant(`answer-${String(index)}`, `Text ${String(index)}`),
    );

    expect(historyPageCount(entries)).toBe(3);
    expect([0, 1, 2].map((page) => historyPage(entries, page).length)).toEqual([20, 20, 1]);
  });
});
