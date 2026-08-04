import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { HistoryEntryRenderer, terminalSafeHistoryText } from "./history-renderer.ts";

initTheme("dark", false);

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

describe("Turn Fold history rendering", () => {
  it("renders message Markdown and escapes terminal controls", () => {
    const renderer = new HistoryEntryRenderer(theme);

    const rendered = renderer.render(assistant("answer", "**safe**\u001b[31m"), 0, 80, false);

    expect(rendered.join("\n")).toContain("safe");
    expect(rendered.join("\n")).toContain("\\x1b[31m");
    expect(rendered.join("\n")).not.toContain("\u001b[31m");
    expect(terminalSafeHistoryText("a\u0000b")).toBe("a\\x00b");
  });

  it("bounds previews and expands the selected entry on demand", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const entry = assistant("large", `start-${"x".repeat(5_000)}-end`);

    const preview = renderer.render(entry, 0, 80, false).join("\n");
    const detail = renderer.render(entry, 0, 80, true).join("\n");

    expect(preview).toContain("press Enter to show more");
    expect(preview).not.toContain("-end");
    expect(detail).toContain("-end");
    expect(renderer.render(entry, 0, 20, false).every((line) => visibleWidth(line) <= 20)).toBe(
      true,
    );
  });

  it("keeps its rendered-block cache bounded", () => {
    const renderer = new HistoryEntryRenderer(theme, 2);

    renderer.render(assistant("one", "one"), 0, 80, false);
    renderer.render(assistant("two", "two"), 1, 80, false);
    renderer.render(assistant("three", "three"), 2, 80, false);

    expect(renderer.cachedBlocks).toBe(2);
  });

  it("summarizes tool calls and unknown entries safely", () => {
    const renderer = new HistoryEntryRenderer(theme);
    const assistantWithTool = {
      id: "tool-call",
      message: {
        content: [{ id: "call", name: "read", type: "toolCall" }],
        role: "assistant",
        timestamp: 1,
      },
      type: "message",
    };

    expect(renderer.render(assistantWithTool, 0, 80, false).join("\n")).toContain("Tool:");
    const unknown = renderer
      .render({ customType: "other\u001b-extension", id: "custom", type: "custom" }, 1, 80, false)
      .join("\n");
    expect(unknown).toContain("other\\x1b-extension");
    expect(unknown).not.toContain("\u001b");
  });
});
