import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryExplorer } from "./history-viewer.ts";
import { HistoryViewport } from "./history-viewport.ts";

initTheme("dark", false);

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  italic: (text: string) => text,
};

afterEach(() => {
  vi.useRealTimers();
});

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
  it("reaches the suffix of expanded entries through detailed pages", () => {
    const entries = [
      {
        id: "huge",
        message: {
          content: `start-${"x".repeat(100_005)}-end`,
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);

    viewport.toggleDetails();
    viewport.moveToNewest();

    expect(viewport.render(80, 8).join("\n")).toContain("-end");
  });

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
    expect(bodyReads).toBeLessThanOrEqual(25);
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

  it("keeps the previous top line visible after page-back admits older windows", () => {
    const viewport = new HistoryViewport(history(10), theme);
    viewport.render(80, 8);
    viewport.moveToOldest();
    const before = viewport.render(80, 8);

    viewport.moveBackward(8);
    const after = viewport.render(80, 8);

    expect(viewport.admittedWindows).toBe(6);
    expect(after.at(-1)).toBe(before[0]);
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
});

describe("Turn Fold history viewport controls", () => {
  it("filters entries and restores exact locations through navigation history", () => {
    const entries = [
      {
        id: "user",
        message: { content: "Question", role: "user", timestamp: 1 },
        type: "message",
      },
      assistant("assistant", "Answer"),
      { id: "compaction", summary: "Summary", type: "compaction" },
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);

    viewport.setFilter("user");
    expect(viewport.render(80, 8).join("\n")).toContain("Question");
    viewport.jumpToEntry(2);
    expect(viewport.filter).toBe("all");
    expect(viewport.context()?.entryIndex).toBe(2);
    expect(viewport.goBack()).toBe(true);
    expect(viewport.filter).toBe("user");
    expect(viewport.goForward()).toBe(true);
    expect(viewport.context()?.entryIndex).toBe(2);
  });

  it("keeps the jump target visible when context entries are tall", () => {
    const tall = `tall ${"x".repeat(3_500)}`;
    const entries = [
      assistant("tall-1", tall),
      assistant("tall-2", tall),
      assistant("target", "Target header"),
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);

    viewport.jumpToEntry(2);

    expect(viewport.render(80, 8).join("\n")).toContain("Target header");
  });

  it("reports when a jump resets the active filter", () => {
    const viewport = new HistoryViewport(
      [
        {
          id: "user",
          message: { content: "Question", role: "user", timestamp: 1 },
          type: "message",
        },
        assistant("assistant", "Answer"),
      ],
      theme,
    );
    viewport.render(80, 8);
    viewport.setFilter("user");

    const jump = viewport.jumpToEntry(1);

    expect(jump.filterReset).toBe(true);
    expect(viewport.filter).toBe("all");
  });

  it("reveals the section containing a search match", () => {
    const entries = [
      {
        id: "thinking",
        message: {
          content: [
            { thinking: "hidden needle", type: "thinking" },
            { text: "answer", type: "text" },
          ],
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);
    viewport.setSearch("needle");

    viewport.jumpToMatch({ entryIndex: 0, section: "thinking", snippet: "needle" });

    expect(viewport.render(80, 8).join("\n")).toContain("hidden needle");
  });

  it("keeps independent section toggles scoped to the focused entry", () => {
    const entries = [
      {
        id: "tool",
        message: {
          content: [{ arguments: { path: "a.ts" }, id: "call", name: "read", type: "toolCall" }],
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
      assistant("answer", "Answer"),
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);
    viewport.jumpToEntry(0);

    expect(viewport.toggleToolOutput()).toBe(true);
    expect(viewport.render(80, 8).join("\n")).toContain("a.ts");
    viewport.jumpToEntry(1);
    expect(viewport.toggleToolOutput()).toBe(false);
  });

  it("expands the current truncated entry without unbounding the cache", () => {
    const viewport = new HistoryViewport(
      [assistant("large", `start-${"x".repeat(5_000)}-end`)],
      theme,
      2,
    );

    expect(viewport.render(80, 8).join("\n")).not.toContain("-end");
    viewport.moveToOldest();
    viewport.toggleDetails();

    expect(viewport.render(80, 8).join("\n")).toContain("start-");
    expect(viewport.cachedBlocks).toBeLessThanOrEqual(2);
  });
});

describe("Turn Fold history explorer", () => {
  it("renders an explicit empty state without claiming a compaction window", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 20 } as never },
      theme,
      [],
      vi.fn(),
    );

    const rendered = explorer.render(80).join("\n");

    expect(rendered).toContain("0 of 0 windows");
    expect(rendered).toContain("no transcript history");
  });

  it("escapes transcript-controlled labels in the sticky title", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 20 } as never },
      theme,
      [{ customType: "other\u001b-extension", id: "custom", type: "custom" }],
      vi.fn(),
    );

    const rendered = explorer.render(80).join("\n");

    expect(rendered).toContain("other\\x1b-extension");
    expect(rendered).not.toContain("\u001b-extension");
  });

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

  it("searches incrementally, highlights a match, and clears before closing", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 20 } as never },
      theme,
      [assistant("one", "Nothing"), assistant("two", "Needle here")],
      close,
    );

    explorer.handleInput("/");
    for (const character of "needle") explorer.handleInput(character);
    explorer.handleInput("\r");
    await vi.runAllTimersAsync();

    expect(explorer.render(100).join("\n")).toContain("search “needle”");
    expect(explorer.render(100).join("\n")).toContain("Needle here");
    explorer.handleInput("\u001b");
    expect(close).not.toHaveBeenCalled();
    explorer.handleInput("\u001b");
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels incremental search work when the explorer closes", async () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const close = vi.fn();
    const explorer = new HistoryExplorer(
      { requestRender, terminal: { rows: 20 } as never },
      theme,
      Array.from({ length: 1_000 }, (_, index) =>
        assistant(String(index), `entry ${String(index)}`),
      ),
      close,
    );
    explorer.handleInput("/");
    explorer.handleInput("x");
    explorer.handleInput("\r");
    const renderCount = requestRender.mock.calls.length;

    explorer.handleInput("\u001b[111;6u");
    await vi.runAllTimersAsync();

    expect(close).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledTimes(renderCount);
  });
});

describe("Turn Fold history explorer controls", () => {
  it("filters, jumps, and navigates back without leaving the overlay", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 20 } as never },
      theme,
      [
        {
          id: "user",
          message: { content: "Question", role: "user", timestamp: 1 },
          type: "message",
        },
        ...history(7),
      ],
      vi.fn(),
    );

    explorer.handleInput("f");
    expect(explorer.render(100).join("\n")).toContain("user messages");
    explorer.handleInput("u");
    expect(explorer.render(100).join("\n")).toContain("Question");
    explorer.handleInput("j");
    explorer.handleInput("w");
    explorer.handleInput("1");
    explorer.handleInput("\r");
    expect(explorer.render(100).join("\n")).toContain("w 1/7");
    explorer.handleInput("[");
    expect(explorer.render(100).join("\n")).toContain("filter user");
  });

  it("opens help and returns to the same transcript position", () => {
    const explorer = new HistoryExplorer(
      { requestRender: vi.fn(), terminal: { rows: 24 } as never },
      theme,
      history(4),
      vi.fn(),
    );
    const before = explorer.render(100).join("\n");

    explorer.handleInput("?");
    expect(explorer.render(100).join("\n")).toContain("Navigation");
    explorer.handleInput("\u001b");

    expect(explorer.render(100).join("\n")).toBe(before);
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
