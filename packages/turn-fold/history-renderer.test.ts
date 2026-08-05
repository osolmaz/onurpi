import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HISTORY_ENTRY_DISPLAY,
  HistoryEntryRenderer,
  terminalSafeHistoryText,
  type HistoryEntryDisplayState,
} from "./history-renderer.ts";

initTheme("dark", false);

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  italic: (text: string) => text,
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

function state(changes: Partial<HistoryEntryDisplayState> = {}): HistoryEntryDisplayState {
  return { ...DEFAULT_HISTORY_ENTRY_DISPLAY, ...changes };
}

describe("Turn Fold history rendering", () => {
  it("renders message Markdown and escapes terminal controls", () => {
    const renderer = new HistoryEntryRenderer(theme);

    const rendered = renderer.render(assistant("answer", "**safe**\u001b[31m"), 0, 80, state());

    expect(rendered.join("\n")).toContain("safe");
    expect(rendered.join("\n")).toContain("\\x1b[31m");
    expect(rendered.join("\n")).not.toContain("\u001b[31m");
    expect(terminalSafeHistoryText("a\u0000b")).toBe("a\\x00b");
  });

  it("bounds previews and expands the selected entry on demand", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = assistant("large", `start-${"x".repeat(5_000)}-end`);
    const previewState = state();
    const detailState = state({ detailed: true });

    const previewSegment = renderer.segmentCount(entry, 0, 80, previewState, 20) - 1;
    const detailSegment = renderer.segmentCount(entry, 0, 80, detailState, 20) - 1;
    const preview = renderer.render(entry, 0, 80, previewState, previewSegment, 20).join("\n");
    const detail = renderer.render(entry, 0, 80, detailState, detailSegment, 20).join("\n");

    expect(preview).toContain("press Enter to show more");
    expect(preview).not.toContain("-end");
    expect(detail).toContain("-end");
    expect(
      renderer.render(entry, 0, 20, previewState).every((line) => visibleWidth(line) <= 20),
    ).toBe(true);
  });

  it("pages through detailed entries beyond the per-page character bound", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = assistant("huge", `start-${"x".repeat(100_005)}-end`);
    const detailState = state({ detailed: true });
    const finalPage = renderer.pageCount(entry, detailState) - 1;
    const firstPageLastSegment = renderer.segmentCount(entry, 0, 80, detailState, 20, 0) - 1;
    const finalSegment = renderer.segmentCount(entry, 0, 80, detailState, 20, finalPage) - 1;

    expect(
      renderer.render(entry, 0, 80, detailState, firstPageLastSegment, 20, 0).join("\n"),
    ).toContain("continue scrolling");
    expect(
      renderer.render(entry, 0, 80, detailState, finalSegment, 20, finalPage).join("\n"),
    ).toContain("-end");
  });

  it("keeps thinking, tool output, and diffs independently collapsible", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const thinkingEntry = {
      id: "thinking",
      message: {
        content: [
          { thinking: "reasoning", type: "thinking" },
          { text: "```diff\n-old\n+new\n```", type: "text" },
          { arguments: { path: "a.ts" }, id: "call", name: "read", type: "toolCall" },
        ],
        role: "assistant",
        timestamp: 1,
      },
      type: "message",
    };

    const collapsed = renderer
      .render(thinkingEntry, 0, 80, state({ showThinking: false, showToolOutput: false }))
      .join("\n");
    const expanded = renderer.render(thinkingEntry, 0, 80, state()).join("\n");
    const diff = renderer.render(thinkingEntry, 0, 80, state({ showDiffs: true })).join("\n");

    expect(collapsed).toContain("Thinking hidden");
    expect(collapsed).toContain("more lines, press o to expand");
    expect(collapsed).toContain("Diff hidden");
    expect(expanded).toContain("reasoning");
    expect(expanded).toContain("a.ts");
    expect(expanded).toContain("Diff hidden");
    expect(diff).toContain("old");
  });

  it("renders only a bounded segment of multiline content", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = assistant(
      "lines",
      Array.from({ length: 4_000 }, (_, index) => `line ${String(index)}`).join("\n"),
    );
    const segmentCount = renderer.segmentCount(entry, 0, 80, state(), 20);

    const rendered = renderer.render(entry, 0, 80, state(), 0, 20);

    expect(segmentCount).toBeGreaterThan(1);
    expect(rendered.length).toBeLessThanOrEqual(20);
    expect(renderer.cachedBlocks).toBe(1);
  });
});

describe("Turn Fold history layout and tool presentation", () => {
  it("puts one blank line before assistant blocks with no header or trailing blank", () => {
    const renderer = new HistoryEntryRenderer(theme);

    const first = renderer.render(assistant("one", "One"), 0, 80, state());
    const second = renderer.render(assistant("two", "Two"), 1, 80, state());

    expect(first[0]?.trim()).toBe("");
    expect(first[1]).toContain("One");
    expect(first.join("\n")).not.toContain("Assistant");
    expect(first.at(-1)?.trim()).not.toBe("");
    expect(second[0]?.trim()).toBe("");
  });

  it("shows a Pi-style truncated tool preview by default", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = {
      id: "tool",
      message: {
        content: Array.from({ length: 8 }, (_, index) => `line ${String(index)}`).join("\n"),
        role: "toolResult",
        timestamp: 1,
        toolName: "exec",
      },
      type: "message",
    };

    const rendered = renderer.render(entry, 0, 80, state({ showToolOutput: false })).join("\n");

    expect(rendered).toContain("line 0");
    expect(rendered).toContain("line 4");
    expect(rendered).not.toContain("line 5");
    expect(rendered).toContain("(3 more lines, press o to expand)");
  });

  it("colors tool headers by success or failure", () => {
    const backgrounds: string[] = [];
    const styledTheme = {
      bg: (color: string, text: string) => {
        backgrounds.push(`${color}:${text}`);
        return text;
      },
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
      italic: (text: string) => text,
    };
    const renderer = new HistoryEntryRenderer(styledTheme);
    const result = (isError: boolean, id: string) => ({
      id,
      message: {
        content: "out",
        isError,
        role: "toolResult",
        timestamp: 1,
        toolName: "exec",
      },
      type: "message",
    });

    renderer.render(result(false, "ok"), 0, 80, state());
    renderer.render(result(true, "bad"), 1, 80, state());

    expect(backgrounds.some((entry) => entry.startsWith("toolSuccessBg:"))).toBe(true);
    expect(backgrounds.some((entry) => entry.startsWith("toolErrorBg:"))).toBe(true);
  });

  it("keeps matched fences and drops only the dangling opener in previews", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = {
      id: "tool",
      message: {
        content: 'before\n```\ncode\n```\n```json\n{ "tail": true }',
        role: "toolResult",
        timestamp: 1,
        toolName: "exec",
      },
      type: "message",
    };

    const rendered = renderer.render(entry, 0, 80, state({ showToolOutput: false })).join("\n");

    expect(rendered).toContain("code");
    expect(rendered).not.toContain("tail");
    expect(rendered).toContain("(2 more lines, press o to expand)");
  });

  it("pairs the call summary into the tool block header", () => {
    const titles: string[] = [];
    const styledTheme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => {
        titles.push(text);
        return text;
      },
      fg: (_color: string, text: string) => text,
      italic: (text: string) => text,
    };
    const renderer = new HistoryEntryRenderer(styledTheme);
    const result = {
      id: "result",
      message: {
        content: "out",
        role: "toolResult",
        timestamp: 1,
        toolCallId: "call-1",
        toolName: "read",
      },
      type: "message",
    };

    renderer.render(result, 0, 80, state(), 0, 20, 0, "", "read · /tmp/plan.md");

    expect(titles).toContain("read · /tmp/plan.md");
  });
});

describe("Turn Fold history role styling", () => {
  it("uses role-specific public Pi theme styles", () => {
    const calls: string[] = [];
    const styledTheme = {
      bg: (color: string, text: string) => {
        calls.push(`bg:${color}`);
        return text;
      },
      bold: (text: string) => text,
      fg: (color: string, text: string) => {
        calls.push(`fg:${color}`);
        return text;
      },
      italic: (text: string) => text,
    };
    const renderer = new HistoryEntryRenderer(styledTheme);
    const user = {
      id: "user",
      message: { content: "Question", role: "user", timestamp: 1 },
      type: "message",
    };

    const rendered = renderer.render(user, 0, 80, state()).join("\n");
    expect(rendered).toContain("Question");
    expect(rendered).not.toContain("You");
    expect(calls).toContain("bg:userMessageBg");
    expect(calls).toContain("fg:userMessageText");
  });

  it("wraps the entire user block in the user message background", () => {
    const backgrounds: string[] = [];
    const styledTheme = {
      bg: (color: string, text: string) => {
        if (color === "userMessageBg") backgrounds.push(text);
        return text;
      },
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
      italic: (text: string) => text,
    };
    const renderer = new HistoryEntryRenderer(styledTheme);
    const user = {
      id: "user",
      message: { content: "Question body", role: "user", timestamp: 1 },
      type: "message",
    };

    const lines = renderer.render(user, 0, 80, state());

    expect(backgrounds.length).toBe(lines.length);
    expect(backgrounds.length).toBeGreaterThanOrEqual(3);
    expect(backgrounds[0]?.trim()).toBe("");
    expect(backgrounds[1]).toContain("Question body");
    expect(backgrounds.at(-1)?.trim()).toBe("");
  });

  it("highlights literal search text and selected headers", () => {
    const calls: string[] = [];
    const styledTheme = {
      bg: (color: string, text: string) => {
        calls.push(`bg:${color}`);
        return text;
      },
      bold: (text: string) => text,
      fg: (color: string, text: string) => {
        calls.push(`fg:${color}`);
        return text;
      },
      italic: (text: string) => text,
    };
    const renderer = new HistoryEntryRenderer(styledTheme);

    renderer.render(assistant("match", "Needle"), 0, 80, state(), 0, 20, 0, "needle");

    expect(calls).toContain("bg:selectedBg");
  });

  it("locates matches after terminal control characters in the right segment", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const prefix = "\u001b[31m".repeat(200);
    const entry = assistant("controls", `${prefix}needle`);

    const located = renderer.locate(entry, 80, state(), 20, "needle");
    const rendered = renderer
      .render(entry, 0, 80, state(), located.segmentIndex, 20, located.pageIndex)
      .join("\n");

    expect(rendered).toContain("needle");
  });

  it("keeps its rendered-block cache bounded", () => {
    const renderer = new HistoryEntryRenderer(theme, 2);

    renderer.render(assistant("one", "one"), 0, 80, state());
    renderer.render(assistant("two", "two"), 1, 80, state());
    renderer.render(assistant("three", "three"), 2, 80, state());

    expect(renderer.cachedBlocks).toBe(2);
  });

  it("summarizes tool calls and unknown entries safely", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const assistantWithTool = {
      id: "tool-call",
      message: {
        content: [{ arguments: { query: "needle" }, id: "call", name: "read", type: "toolCall" }],
        role: "assistant",
        timestamp: 1,
      },
      type: "message",
    };

    expect(renderer.render(assistantWithTool, 0, 80, state()).join("\n")).toContain(
      "read · needle",
    );
    const unknown = renderer
      .render({ customType: "other\u001b-extension", id: "custom", type: "custom" }, 1, 80, state())
      .join("\n");
    expect(unknown).toContain("other\\x1b-extension");
    expect(unknown).not.toContain("\u001b");
  });
});
