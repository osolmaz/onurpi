import { describe, expect, it } from "vitest";

import {
  isPreCompactionVisibility,
  nextPreCompactionVisibility,
  selectPreCompactionEntries,
} from "./history-scope.ts";

type Entry = Parameters<typeof selectPreCompactionEntries>[0][number];

function entry(id: string, type = "custom"): Entry {
  if (type === "compaction") {
    return {
      firstKeptEntryId: id,
      id,
      parentId: null,
      summary: id,
      timestamp: "2026-08-04T00:00:00.000Z",
      tokensBefore: 1,
      type: "compaction",
    };
  }
  return {
    customType: "test",
    data: {},
    id,
    parentId: null,
    timestamp: "2026-08-04T00:00:00.000Z",
    type: "custom",
  };
}

function ids(entries: readonly Entry[]): string[] {
  return entries.map((candidate) => candidate.id);
}

describe("pre-compaction history scope", () => {
  it("validates and toggles visibility", () => {
    expect(isPreCompactionVisibility("show")).toBe(true);
    expect(isPreCompactionVisibility("hide")).toBe(true);
    expect(isPreCompactionVisibility("all")).toBe(false);
    expect(nextPreCompactionVisibility("show")).toBe("hide");
    expect(nextPreCompactionVisibility("hide")).toBe("show");
  });

  it("shows the selected source unchanged", () => {
    const entries = [entry("before"), entry("compact", "compaction"), entry("after")];
    expect(ids(selectPreCompactionEntries(entries, "show"))).toEqual([
      "before",
      "compact",
      "after",
    ]);
  });

  it("hides entries before the newest compaction boundary", () => {
    const entries = [
      entry("before-first"),
      entry("first", "compaction"),
      entry("between"),
      entry("latest", "compaction"),
      entry("after"),
    ];
    expect(ids(selectPreCompactionEntries(entries, "hide"))).toEqual(["latest", "after"]);
  });

  it("keeps an uncompacted source unchanged", () => {
    const entries = [entry("first"), entry("second")];
    expect(ids(selectPreCompactionEntries(entries, "hide"))).toEqual(["first", "second"]);
  });
});
