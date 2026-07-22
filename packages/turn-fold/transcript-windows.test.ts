import { describe, expect, it } from "vitest";

import {
  ALL_TRANSCRIPT_WINDOWS,
  compactionWindowCount,
  DEFAULT_TRANSCRIPT_WINDOWS,
  formatTranscriptWindowValue,
  isTranscriptWindowValue,
  resolveWindowArgument,
  selectTranscriptEntries,
} from "./transcript-windows.ts";

type Entry = Parameters<typeof selectTranscriptEntries>[0][number];

function entry(id: string, type = "custom"): Entry {
  if (type === "compaction") {
    return {
      firstKeptEntryId: id,
      id,
      parentId: null,
      summary: id,
      timestamp: "2026-07-22T00:00:00.000Z",
      tokensBefore: 1,
      type: "compaction",
    };
  }
  return {
    customType: "test",
    data: {},
    id,
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "custom",
  };
}

function user(id: string): Entry {
  return {
    id,
    message: { content: id, role: "user", timestamp: 1 },
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "message",
  };
}

function ids(entries: readonly Entry[]): string[] {
  return entries.map((candidate) => candidate.id);
}

describe("transcript window selection", () => {
  it("counts the current window in empty and compacted branches", () => {
    expect(compactionWindowCount([])).toBe(1);
    expect(compactionWindowCount([entry("a"), entry("c1", "compaction")])).toBe(2);
  });

  it("keeps the full branch when it has fewer compactions than the limit", () => {
    const branch = [user("u1"), entry("c1", "compaction"), entry("a1")];
    expect(ids(selectTranscriptEntries(branch, 3))).toEqual(["u1", "c1", "a1"]);
  });

  it("selects the requested windows and their preceding user anchor", () => {
    const branch = [
      user("u0"),
      entry("a0"),
      entry("c1", "compaction"),
      user("u1"),
      entry("a1"),
      entry("c2", "compaction"),
      user("u2"),
      entry("a2"),
      entry("c3", "compaction"),
      entry("a3"),
    ];

    expect(ids(selectTranscriptEntries(branch, 2))).toEqual([
      "u1",
      "a1",
      "c2",
      "u2",
      "a2",
      "c3",
      "a3",
    ]);
    expect(ids(selectTranscriptEntries(branch, 1))).toEqual(["u2", "a2", "c3", "a3"]);
  });

  it("keeps a split turn's user anchor across repeated compactions", () => {
    const branch = [
      user("old"),
      entry("old-a"),
      user("anchor"),
      entry("tool-a"),
      entry("c1", "compaction"),
      entry("tool-b"),
      entry("c2", "compaction"),
      entry("done"),
    ];

    expect(ids(selectTranscriptEntries(branch, 2))).toEqual([
      "anchor",
      "tool-a",
      "c1",
      "tool-b",
      "c2",
      "done",
    ]);
  });

  it("starts at the boundary when no preceding user exists", () => {
    const branch = [entry("custom"), entry("c1", "compaction"), entry("after")];
    expect(ids(selectTranscriptEntries(branch, 1))).toEqual(["c1", "after"]);
  });

  it("returns the full active branch for all", () => {
    const branch = [user("u1"), entry("c1", "compaction"), entry("a1")];
    expect(ids(selectTranscriptEntries(branch, ALL_TRANSCRIPT_WINDOWS))).toEqual([
      "u1",
      "c1",
      "a1",
    ]);
  });
});

describe("transcript window values", () => {
  it("validates and formats supported values", () => {
    expect(isTranscriptWindowValue(1)).toBe(true);
    expect(isTranscriptWindowValue(0)).toBe(false);
    expect(isTranscriptWindowValue(1.5)).toBe(false);
    expect(isTranscriptWindowValue(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isTranscriptWindowValue(ALL_TRANSCRIPT_WINDOWS)).toBe(true);
    expect(formatTranscriptWindowValue(4)).toBe("4");
    expect(formatTranscriptWindowValue(ALL_TRANSCRIPT_WINDOWS)).toBe("all");
  });

  it("resolves exact, all, and reset values", () => {
    expect(resolveWindowArgument("5", 3, 8)).toEqual({ ok: true, value: 5 });
    expect(resolveWindowArgument(" ALL ", 3, 8)).toEqual({ ok: true, value: "all" });
    expect(resolveWindowArgument("reset", 8, 8)).toEqual({
      ok: true,
      value: DEFAULT_TRANSCRIPT_WINDOWS,
    });
  });

  it("resolves relative values and clamps subtraction to one", () => {
    expect(resolveWindowArgument("+2", 3, 8)).toEqual({ ok: true, value: 5 });
    expect(resolveWindowArgument("-9", 3, 8)).toEqual({ ok: true, value: 1 });
    expect(resolveWindowArgument("+2", "all", 8)).toEqual({ ok: true, value: "all" });
    expect(resolveWindowArgument("-2", "all", 8)).toEqual({ ok: true, value: 6 });
  });

  it("rejects unsupported and unsafe values", () => {
    for (const value of ["", "0", "-0", "+0", "1.5", "wat", "99999999999999999999"]) {
      expect(resolveWindowArgument(value, 3, 8)).toMatchObject({ ok: false });
    }
  });
});
