import { describe, expect, it } from "vitest";

import { HistorySearch } from "./history-search.ts";

function message(id: string, role: string, text: string): unknown {
  return { id, message: { content: text, role, timestamp: 1 }, type: "message" };
}

describe("Turn Fold history search", () => {
  it("finds one case-insensitive result per entry", () => {
    const search = new HistorySearch([
      message("one", "user", "Needle needle"),
      message("two", "assistant", "A NEEDLE here"),
    ]);

    search.start("needle", "all");
    search.step();

    expect(search.progress).toEqual({
      complete: true,
      matchedEntries: 2,
      scannedEntries: 2,
      totalEntries: 2,
    });
    expect(search.results.map((result) => result.entryIndex)).toEqual([0, 1]);
    expect(search.results[0]?.snippet).toContain("Needle");
  });

  it("scans large entries in bounded character slices", () => {
    const search = new HistorySearch([
      message("large", "assistant", `${"x".repeat(10_000)}needle`),
    ]);
    search.start("needle", "all");

    search.step(1, 100);
    expect(search.complete).toBe(false);
    for (let index = 0; index < 101 && !search.complete; index += 1) search.step(1, 100);

    expect(search.complete).toBe(true);
    expect(search.results).toHaveLength(1);
  });

  it("applies the active filter", () => {
    const search = new HistorySearch([
      message("user", "user", "needle"),
      message("assistant", "assistant", "needle"),
    ]);

    search.start("needle", "user");
    search.step();

    expect(search.results.map((result) => result.entryIndex)).toEqual([0]);
    expect(search.filter).toBe("user");
  });

  it("identifies the section containing a match", () => {
    const search = new HistorySearch([
      {
        id: "thinking",
        message: {
          content: [
            { thinking: "private needle", type: "thinking" },
            { text: "answer", type: "text" },
          ],
          role: "assistant",
          timestamp: 1,
        },
        type: "message",
      },
    ]);

    search.start("needle", "all");
    search.step();

    expect(search.results[0]?.section).toBe("thinking");
  });

  it("wraps next and previous navigation", () => {
    const search = new HistorySearch([
      message("zero", "assistant", "needle"),
      message("one", "assistant", "none"),
      message("two", "assistant", "needle"),
    ]);
    search.start("needle", "all");
    search.step();

    expect(search.next(0, 1)?.entryIndex).toBe(2);
    expect(search.next(2, 1)?.entryIndex).toBe(0);
    expect(search.next(0, -1)?.entryIndex).toBe(2);
    expect(search.next(1, 1)?.entryIndex).toBe(2);
    expect(search.ordinal(2)).toBe(2);
  });

  it("clears active search state", () => {
    const search = new HistorySearch([message("one", "assistant", "needle")]);
    search.start("needle", "all");
    search.step();
    search.clear();

    expect(search.query).toBe("");
    expect(search.results).toHaveLength(0);
    expect(search.complete).toBe(true);
  });
});
