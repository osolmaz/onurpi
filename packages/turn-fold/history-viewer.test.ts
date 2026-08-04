import { describe, expect, it, vi } from "vitest";

import { HistoryExplorer, HistoryViewport } from "./history-viewer.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};

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

function history(windowCount: number): unknown[] {
  const entries: unknown[] = [assistant("answer-0", "Answer 0")];
  for (let index = 1; index < windowCount; index += 1) {
    entries.push({
      id: `compaction-${String(index)}`,
      summary: `Summary ${String(index)}`,
      type: "compaction",
    });
    entries.push(assistant(`answer-${String(index)}`, `Answer ${String(index)}`));
  }
  return entries;
}

describe("Turn Fold history viewport", () => {
  it("renders only viewport-near entry bodies when opening large history", () => {
    let bodyReads = 0;
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      id: `answer-${String(index)}`,
      get message(): unknown {
        bodyReads += 1;
        return {
          content: [{ text: `Text ${String(index)}`, type: "text" }],
          role: "assistant",
          timestamp: index,
        };
      },
      type: "message",
    }));
    const viewport = new HistoryViewport(entries, theme);

    const rendered = viewport.render(80, 20);

    expect(rendered.join("\n")).toContain("Text 999");
    expect(bodyReads).toBeLessThan(20);
  });

  it("starts with three windows and admits three older windows at the boundary", () => {
    const viewport = new HistoryViewport(history(10), theme);
    viewport.render(80, 8);

    expect(viewport.admittedWindows).toBe(3);
    viewport.moveToOldest();
    viewport.moveBackward(1);

    expect(viewport.admittedWindows).toBe(6);
    expect(viewport.render(80, 8).join("\n")).toContain("Summary 7");
    viewport.moveToOldest();
    expect(viewport.render(80, 8).join("\n")).toContain("Answer 4");
  });

  it("reaches the branch root through repeated bounded loads", () => {
    const viewport = new HistoryViewport(history(8), theme);
    viewport.render(80, 5);

    for (let index = 0; index < 3; index += 1) {
      viewport.moveToOldest();
      viewport.moveBackward(1);
    }

    expect(viewport.admittedWindows).toBe(8);
    viewport.moveToOldest();
    expect(viewport.render(80, 5).join("\n")).toContain("Answer 0");
  });

  it("moves backward and forward without scrolling past the newest viewport", () => {
    const viewport = new HistoryViewport(history(4), theme);
    const newest = viewport.render(80, 5).join("\n");

    viewport.moveBackward(3);
    expect(viewport.render(80, 5).join("\n")).not.toBe(newest);
    viewport.moveForward(100);

    expect(viewport.render(80, 5).join("\n")).toBe(newest);
  });

  it("keeps the newest content anchored across terminal resizing", () => {
    const viewport = new HistoryViewport(history(4), theme);
    viewport.render(80, 5);

    const resized = viewport.render(40, 8).join("\n");

    expect(resized).toContain("Answer 3");
    expect(resized).not.toContain("Answer 0");
  });

  it("expands the current truncated entry without unbounding the cache", () => {
    const viewport = new HistoryViewport(
      [assistant("large", `start-${"x".repeat(5_000)}-end`)],
      theme,
      2,
    );

    expect(viewport.render(80, 8).join("\n")).not.toContain("-end");
    viewport.moveToOldest();
    viewport.toggleCurrentEntry();

    expect(viewport.render(80, 8).join("\n")).toContain("start-");
    expect(viewport.cachedBlocks).toBeLessThanOrEqual(2);
  });
});

describe("Turn Fold history explorer", () => {
  it("renders a Pi overlay and supports Mac-accessible movement", () => {
    const requestRender = vi.fn();
    const close = vi.fn();
    const explorer = new HistoryExplorer(
      { requestRender, terminal: { rows: 20 } as never },
      theme,
      history(7),
      close,
    );

    const rendered = explorer.render(80);
    expect(rendered).toHaveLength(18);
    expect(rendered.join("\n")).toContain("3 of 7 windows");
    explorer.handleInput("b");
    explorer.handleInput(" ");
    explorer.handleInput("\u0010");
    explorer.handleInput("\u000e");

    expect(requestRender).toHaveBeenCalledTimes(4);
    expect(close).not.toHaveBeenCalled();
  });

  it("fits compact chrome within very short terminals", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 6 } as never },
      theme,
      history(2),
      vi.fn(),
    );

    expect(explorer.render(80)).toHaveLength(4);
  });

  it("closes with q, escape, or the same shortcut exactly once", () => {
    for (const key of ["q", "\u001b", "\u001b[111;6u"]) {
      const close = vi.fn();
      const explorer = new HistoryExplorer(
        { requestRender: vi.fn(), terminal: { rows: 20 } as never },
        theme,
        history(1),
        close,
      );

      explorer.handleInput(key);
      explorer.close();
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("invalidates cached blocks on theme changes", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 20 } as never },
      theme,
      history(2),
      vi.fn(),
    );

    explorer.render(80);
    expect(() => {
      explorer.invalidate();
    }).not.toThrow();
    expect(explorer.render(60).every((line) => line.length >= 0)).toBe(true);
    expect(explorer.render(2)).toEqual(["  "]);
  });
});
