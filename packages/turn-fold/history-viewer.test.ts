import { initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, type Terminal, type TuiMode, TuiAltScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryExplorer } from "./history-viewer.ts";
import { HistoryViewport } from "./history-viewport.ts";

initTheme("dark", false);

function fakeTui(
  rows: number,
  mode: TuiMode = "regular",
): {
  mode: TuiMode;
  requestRender: ReturnType<typeof vi.fn>;
  terminal: { rows: number; write: ReturnType<typeof vi.fn> };
} {
  return { mode, requestRender: vi.fn(), terminal: { rows, write: vi.fn() } };
}

class InputTerminal implements Terminal {
  readonly columns = 100;
  readonly kittyProtocolActive = false;
  readonly operations: string[] = [];
  readonly rows = 30;
  readonly writes: string[] = [];
  private onInput: ((data: string) => void) | undefined;

  clearFromCursor(): void {
    this.operations.push("clearFromCursor");
  }
  clearLine(): void {
    this.operations.push("clearLine");
  }
  clearScreen(): void {
    this.operations.push("clearScreen");
  }
  async drainInput(): Promise<void> {
    await Promise.resolve();
  }
  hideCursor(): void {
    this.operations.push("hideCursor");
  }
  moveBy(lines: number): void {
    this.operations.push(`moveBy:${String(lines)}`);
  }
  send(data: string): void {
    this.onInput?.(data);
  }
  setProgress(active: boolean): void {
    this.operations.push(`setProgress:${String(active)}`);
  }
  setTitle(title: string): void {
    this.operations.push(`setTitle:${title}`);
  }
  showCursor(): void {
    this.operations.push("showCursor");
  }
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {
    this.onInput = undefined;
  }
  write(data: string): void {
    this.writes.push(data);
  }
}

class LongTranscript implements Component {
  private invalidations = 0;

  invalidate(): void {
    this.invalidations += 1;
  }
  render(): string[] {
    return Array.from({ length: 100 }, (_, index) => `transcript row ${String(index)}`);
  }
}

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
    // Two bounded reads per visible entry: presentation plus tool-call pairing inspection.
    expect(bodyReads).toBeLessThanOrEqual(45);
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
  it("admits older windows when hopping back past the admitted boundary", () => {
    const viewport = new HistoryViewport(history(10), theme);
    viewport.render(80, 8);
    viewport.moveToOldest();

    const jump = viewport.hopEntry(-1);

    expect(jump.moved).toBe(true);
    expect(viewport.admittedWindows).toBeGreaterThan(3);
  });

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

    const lines = viewport.render(80, 8);
    expect(lines.at(-1)).toContain("Target header");
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

  it("shows thinking and tool output by default and toggles one entry", () => {
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

    expect(viewport.render(80, 8).join("\n")).toContain('"path"');
    expect(viewport.toggleToolOutput()).toBe(true);
    expect(viewport.render(80, 8).join("\n")).toContain("more lines, press o to expand");
    viewport.jumpToEntry(1);
    expect(viewport.toggleToolOutput()).toBe(false);
  });

  it("toggles a section for all entries and clears single-entry overrides", () => {
    const entries = [
      {
        id: "tool",
        message: {
          content: [
            {
              arguments: { extra: "z".repeat(300), path: "a.ts" },
              id: "call",
              name: "read",
              type: "toolCall",
            },
          ],
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
      assistant("answer", "Answer"),
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);

    viewport.toggleAllToolOutput();
    expect(viewport.render(80, 8).join("\n")).toContain("more lines, press o to expand");
    expect(viewport.render(80, 8).join("\n")).not.toContain("```");

    viewport.jumpToEntry(0);
    viewport.toggleToolOutput();
    expect(viewport.render(80, 8).join("\n")).not.toContain("more lines, press o to expand");

    viewport.toggleAllToolOutput();
    viewport.jumpToEntry(0);
    viewport.toggleToolOutput();
    expect(viewport.render(80, 12).join("\n")).toContain("more lines, press o to expand");
  });
});

describe("Turn Fold history viewport display defaults", () => {
  it("clamps the scroll position when an all-entry toggle shrinks a deep entry", () => {
    const entries = [
      {
        id: "tool",
        message: {
          content: [
            {
              arguments: { payload: "x".repeat(120_000) },
              id: "call",
              name: "exec",
              type: "toolCall",
            },
          ],
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
    ];
    const viewport = new HistoryViewport(entries, theme);
    viewport.render(80, 8);
    viewport.jumpToEntry(0);
    viewport.toggleDetails();
    viewport.moveToNewest();

    viewport.toggleAllToolOutput();
    const rendered = viewport.render(80, 8).join("\n");

    expect(rendered.trim().length).toBeGreaterThan(0);
    expect(rendered).toContain("more lines, press o to expand");
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

describe("Turn Fold history explorer mouse support", () => {
  it("owns SGR mouse tracking only while open in regular mode", () => {
    const tui = fakeTui(20);
    const close = vi.fn();
    const explorer = new HistoryExplorer(tui, theme, history(3), close);

    expect(tui.terminal.write).toHaveBeenCalledTimes(1);
    expect(tui.terminal.write).toHaveBeenCalledWith("\u001b[?1002h\u001b[?1006h");

    explorer.close();
    explorer.close();

    expect(tui.terminal.write).toHaveBeenCalledTimes(2);
    expect(tui.terminal.write).toHaveBeenLastCalledWith("\u001b[?1002l\u001b[?1006l");
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves Pi-owned mouse tracking in fullscreen mode", () => {
    const tui = fakeTui(20, "fullscreen");
    const explorer = new HistoryExplorer(tui, theme, history(10), vi.fn());
    const newest = explorer.render(80).join("\n");

    expect(tui.terminal.write).not.toHaveBeenCalled();
    explorer.handleInput("\u001b[<64;10;5M");
    expect(explorer.render(80).join("\n")).not.toBe(newest);

    explorer.close();
    explorer.close();
    expect(tui.terminal.write).not.toHaveBeenCalled();
  });

  it("receives wheel input through Pi's focused fullscreen overlay", () => {
    const terminal = new InputTerminal();
    const tui = new TuiAltScreen(terminal);
    const explorer = new HistoryExplorer(tui, theme, history(10), vi.fn());
    tui.addChild(new LongTranscript());
    tui.start();
    const overlay = tui.showOverlay(explorer, {
      anchor: "center",
      margin: 0,
      maxHeight: "100%",
      width: "100%",
    });

    try {
      const newest = explorer.render(80).join("\n");
      const transcriptTop = tui.viewportTop;

      terminal.send("\u001b[<64;10;5M");

      expect(explorer.render(80).join("\n")).not.toBe(newest);
      expect(tui.viewportTop).toBe(transcriptTop);
    } finally {
      overlay.hide();
      explorer.close();
      tui.stop({ preserveScreen: true });
    }
  });

  it("scrolls the transcript with wheel input in browse mode", () => {
    const tui = fakeTui(20);
    const explorer = new HistoryExplorer(tui, theme, history(10), vi.fn());
    const normalize = (frame: string) => frame.replace(/\d+ of 10 windows/u, "N of 10 windows");
    const newest = explorer.render(80).join("\n");

    explorer.handleInput("\u001b[<64;10;5M");
    const scrolled = explorer.render(80).join("\n");
    explorer.handleInput("\u001b[<65;10;5M");

    expect(scrolled).not.toBe(newest);
    expect(normalize(explorer.render(80).join("\n"))).toBe(normalize(newest));
    expect(tui.requestRender).toHaveBeenCalledTimes(2);
  });

  it("scrolls help with wheel input while help is open", () => {
    const explorer = new HistoryExplorer(fakeTui(16), theme, history(3), vi.fn());
    explorer.handleInput("?");
    const first = explorer.render(100).join("\n");

    explorer.handleInput("\u001b[<65;10;5M");
    explorer.handleInput("\u001b[<65;10;5M");

    expect(explorer.render(100).join("\n")).not.toBe(first);
    explorer.handleInput("\u001b[<64;10;5M");
    explorer.handleInput("\u001b[<64;10;5M");
    expect(explorer.render(100).join("\n")).toBe(first);
  });

  it("keeps the viewport fixed while a subview handles wheel input", () => {
    const tui = fakeTui(20);
    const explorer = new HistoryExplorer(tui, theme, history(8), vi.fn());
    const before = explorer.render(80).join("\n");

    explorer.handleInput("F");
    explorer.handleInput("\u001b[<64;10;5M");
    explorer.handleInput("\u001b[<64;10;5M");
    explorer.handleInput("\u001b");

    expect(explorer.render(80).join("\n")).toBe(before);
  });

  it("ignores clicks, releases, motion, and horizontal wheel codes", () => {
    const tui = fakeTui(20);
    const explorer = new HistoryExplorer(tui, theme, history(5), vi.fn());
    const before = explorer.render(80).join("\n");
    tui.requestRender.mockClear();

    explorer.handleInput("\u001b[<0;10;5M");
    explorer.handleInput("\u001b[<64;10;5m");
    explorer.handleInput("\u001b[<35;10;5M");
    explorer.handleInput("\u001b[<66;10;5M");

    expect(explorer.render(80).join("\n")).toBe(before);
    expect(tui.requestRender).not.toHaveBeenCalled();
  });
});

describe("Turn Fold history explorer hops", () => {
  it("hops between entries and user messages with navigation history", () => {
    const requestRender = vi.fn();
    const explorer = new HistoryExplorer(
      { ...fakeTui(20), requestRender },
      theme,
      [
        {
          id: "u1",
          message: { content: "First question", role: "user", timestamp: 1 },
          type: "message",
        },
        assistant("a1", "Answer one"),
        {
          id: "u2",
          message: { content: "Second question", role: "user", timestamp: 2 },
          type: "message",
        },
        assistant("a2", "Answer two"),
      ],
      vi.fn(),
    );

    explorer.handleInput("[");
    expect(explorer.render(100).join("\n")).toContain("First question");
    explorer.handleInput("{");
    expect(explorer.render(100).join("\n")).toContain("First question");
    explorer.handleInput("}");
    expect(explorer.render(100).join("\n")).toContain("Second question");
    explorer.handleInput("\u001b[Z");
    expect(explorer.render(100).join("\n")).toContain("Moved back");
    explorer.handleInput("\t");
    expect(explorer.render(100).join("\n")).toContain("Moved forward");
  });

  it("fills every subview row so the conversation never bleeds through", () => {
    const explorer = new HistoryExplorer(fakeTui(30), theme, history(2), vi.fn());

    explorer.handleInput("?");
    const help = explorer.render(100);
    explorer.handleInput("\u001b");
    explorer.handleInput("F");
    const filter = explorer.render(100);

    expect(help).toHaveLength(30);
    expect(filter).toHaveLength(30);
  });

  it("uses n for matches while searching and for pages otherwise", async () => {
    vi.useFakeTimers();
    const explorer = new HistoryExplorer(
      fakeTui(20),
      theme,
      [assistant("one", "Nothing"), assistant("two", "Needle")],
      vi.fn(),
    );
    explorer.handleInput("/");
    for (const character of "needle") explorer.handleInput(character);
    explorer.handleInput("\r");
    await vi.runAllTimersAsync();

    expect(explorer.render(100).join("\n")).toContain("search “needle”");
    explorer.handleInput("\u001b");
    expect(explorer.render(100).join("\n")).not.toContain("search “needle”");
  });
});

describe("Turn Fold history explorer", () => {
  it("renders an explicit empty state without claiming a compaction window", () => {
    const explorer = new HistoryExplorer(fakeTui(20), theme, [], vi.fn());

    const rendered = explorer.render(80).join("\n");

    expect(rendered).toContain("0 of 0 windows");
    expect(rendered).toContain("no transcript history");
  });

  it("escapes transcript-controlled labels in the sticky title", () => {
    const explorer = new HistoryExplorer(
      fakeTui(20),
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
      { ...fakeTui(20), requestRender },
      theme,
      history(7),
      close,
    );

    const rendered = explorer.render(80);
    expect(rendered).toHaveLength(20);
    expect(rendered.join("\n")).toContain("3 of 7 windows");
    expect(rendered.join("\n")).not.toContain("+---");
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
      fakeTui(20),
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
      { ...fakeTui(20), requestRender },
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
      fakeTui(20),
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

    explorer.handleInput("F");
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
    const explorer = new HistoryExplorer(fakeTui(24), theme, history(4), vi.fn());
    const before = explorer.render(100).join("\n");

    explorer.handleInput("?");
    expect(explorer.render(100).join("\n")).toContain("Navigation");
    explorer.handleInput("\u001b");

    expect(explorer.render(100).join("\n")).toBe(before);
  });

  it("fits compact chrome within very short terminals", () => {
    const explorer = new HistoryExplorer(fakeTui(6), theme, history(2), vi.fn());

    expect(explorer.render(80)).toHaveLength(6);
    expect(explorer.render(80).join("\n")).not.toContain("+---");
  });

  it("closes with q, escape, or the same shortcut exactly once", () => {
    for (const key of ["q", "\u001b", "\u001b[111;6u"]) {
      const close = vi.fn();
      const explorer = new HistoryExplorer(fakeTui(20), theme, history(1), close);

      explorer.handleInput(key);
      explorer.close();
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("invalidates cached blocks on theme changes", () => {
    const explorer = new HistoryExplorer(fakeTui(20), theme, history(2), vi.fn());

    explorer.render(80);
    expect(() => {
      explorer.invalidate();
    }).not.toThrow();
    expect(explorer.render(60).every((line) => line.length >= 0)).toBe(true);
    expect(explorer.render(2)).toEqual(["  "]);
  });
});
