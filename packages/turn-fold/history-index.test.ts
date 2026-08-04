import { describe, expect, it } from "vitest";

import { createHistoryIndex, HistoryRange, historyStartIndex } from "./history-index.ts";

function entry(id: string, type = "message"): unknown {
  return { id, type };
}

describe("Turn Fold history index", () => {
  it("indexes exact compaction windows without reading message bodies", () => {
    const bodyReads = { count: 0 };
    const entries = [
      {
        id: "message-1",
        get message(): unknown {
          bodyReads.count += 1;
          return { content: "unread", role: "user" };
        },
        type: "message",
      },
      entry("compaction-1", "compaction"),
      entry("message-2"),
      entry("compaction-2", "compaction"),
      entry("message-3"),
      entry("compaction-3", "compaction"),
      entry("message-4"),
    ];

    const index = createHistoryIndex(entries);

    expect(index.totalWindows).toBe(4);
    expect(index.windowStarts).toEqual([0, 1, 3, 5]);
    expect(historyStartIndex(index, 3)).toBe(1);
    expect(bodyReads.count).toBe(0);
  });

  it("omits Turn Fold's internal configuration and run-boundary rows", () => {
    const index = createHistoryIndex([
      entry("visible"),
      { customType: "onurpi-turn-fold-run", id: "run", type: "custom" },
      { customType: "onurpi-turn-fold-config", id: "config", type: "custom" },
      { customType: "other-extension", id: "other", type: "custom" },
    ]);

    expect(index.entries).toEqual([
      entry("visible"),
      { customType: "other-extension", id: "other", type: "custom" },
    ]);
  });

  it("admits three newest windows at a time until the root", () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      entry(`entry-${String(index)}`, index % 2 === 1 ? "compaction" : "message"),
    );
    const range = new HistoryRange(createHistoryIndex(entries));

    expect(range.admittedWindows).toBe(3);
    expect(range.startIndex).toBe(3);
    expect(range.loadOlder()).toBe(true);
    expect(range.admittedWindows).toBe(5);
    expect(range.startIndex).toBe(0);
    expect(range.loadOlder()).toBe(false);
  });

  it("handles branches with fewer than three windows", () => {
    const range = new HistoryRange(createHistoryIndex([entry("only")]));

    expect(range.admittedWindows).toBe(1);
    expect(range.startIndex).toBe(0);
    expect(range.loadOlder()).toBe(false);
  });
});
