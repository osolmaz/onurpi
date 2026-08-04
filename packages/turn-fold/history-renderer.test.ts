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

    const collapsed = renderer.render(thinkingEntry, 0, 80, state()).join("\n");
    const thinking = renderer
      .render(thinkingEntry, 0, 80, state({ showThinking: true }))
      .join("\n");
    const tool = renderer.render(thinkingEntry, 0, 80, state({ showToolOutput: true })).join("\n");
    const diff = renderer.render(thinkingEntry, 0, 80, state({ showDiffs: true })).join("\n");

    expect(collapsed).toContain("Thinking hidden");
    expect(collapsed).toContain("Tool details hidden");
    expect(collapsed).toContain("Diff hidden");
    expect(thinking).toContain("reasoning");
    expect(tool).toContain("a.ts");
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

    expect(renderer.render(user, 0, 80, state()).join("\n")).toContain("◆ You");
    expect(calls).toContain("bg:userMessageBg");
    expect(calls).toContain("fg:userMessageText");
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

    renderer.render(assistant("match", "Needle"), 0, 80, state(), 0, 20, 0, "needle", true);

    expect(calls).toContain("bg:selectedBg");
    expect(calls).toContain("fg:borderAccent");
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
