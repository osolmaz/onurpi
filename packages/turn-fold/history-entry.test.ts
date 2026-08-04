import { describe, expect, it } from "vitest";

import {
  historyEntryMatchesFilter,
  historyEntryPresentation,
  historyFilterKey,
  nextHistoryFilter,
} from "./history-entry.ts";

function message(role: string, content: unknown, extras: object = {}): unknown {
  return { id: role, message: { content, role, timestamp: 1, ...extras }, type: "message" };
}

describe("Turn Fold history entries", () => {
  it("classifies user and assistant messages", () => {
    expect(historyEntryPresentation(message("user", "Question")).kind).toBe("user");
    expect(
      historyEntryPresentation(message("assistant", [{ text: "Answer", type: "text" }])).kind,
    ).toBe("assistant");
  });

  it("separates thinking and fenced diffs", () => {
    const presented = historyEntryPresentation(
      message("assistant", [
        { thinking: "Reason", type: "thinking" },
        { text: "Before\n```diff\n-old\n+new\n```\nAfter", type: "text" },
      ]),
    );

    expect(presented.hasThinking).toBe(true);
    expect(presented.hasDiff).toBe(true);
    expect(presented.sections.map((section) => section.kind)).toEqual([
      "thinking",
      "text",
      "diff",
      "text",
    ]);
  });

  it("summarizes common tool arguments", () => {
    const presented = historyEntryPresentation(
      message("assistant", [
        { arguments: { path: "/tmp/example.ts" }, id: "call", name: "read", type: "toolCall" },
      ]),
    );

    expect(presented.kind).toBe("tool");
    expect(presented.summary).toContain("read · /tmp/example.ts");
    expect(presented.searchableText).toContain("/tmp/example.ts");
  });

  it("distinguishes successful tool results from errors", () => {
    const success = message("toolResult", "done", { isError: false, toolName: "exec" });
    const failure = message("toolResult", "boom", { isError: true, toolName: "exec" });

    expect(historyEntryPresentation(success).kind).toBe("tool");
    expect(historyEntryPresentation(failure).kind).toBe("error");
    expect(historyEntryPresentation(failure).label).toBe("Tool error · exec");
  });

  it("recognizes patch-shaped tool output as a diff", () => {
    const presented = historyEntryPresentation(
      message("toolResult", "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new", {
        toolName: "edit",
      }),
    );

    expect(presented.hasDiff).toBe(true);
    expect(presented.sections[0]?.kind).toBe("diff");
  });

  it("classifies compactions and custom rows", () => {
    expect(historyEntryPresentation({ id: "c", summary: "summary", type: "compaction" }).kind).toBe(
      "compaction",
    );
    expect(historyEntryPresentation({ customType: "notice", id: "n", type: "custom" }).kind).toBe(
      "custom",
    );
  });

  it("matches filters without conflating successful tools and errors", () => {
    const failure = message("toolResult", "boom", { isError: true, toolName: "exec" });

    expect(historyEntryMatchesFilter(failure, "tools")).toBe(true);
    expect(historyEntryMatchesFilter(failure, "errors")).toBe(true);
    expect(historyEntryMatchesFilter(failure, "assistant")).toBe(false);
  });

  it("maps filter keys and cycles in both directions", () => {
    expect(historyFilterKey("u")).toBe("user");
    expect(historyFilterKey("z")).toBeUndefined();
    expect(nextHistoryFilter("all")).toBe("user");
    expect(nextHistoryFilter("all", -1)).toBe("custom");
  });
});
