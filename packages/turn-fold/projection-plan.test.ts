import { describe, expect, it } from "vitest";

import type { TurnFoldConfiguration } from "./configuration.ts";
import { canApplyProjectionInPlace, planTranscriptProjection } from "./projection-plan.ts";

type Branch = Parameters<typeof planTranscriptProjection>[0];
type Entry = Branch[number];

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
    content: id,
    customType: "test",
    details: {},
    display: true,
    id,
    parentId: null,
    timestamp: "2026-08-04T00:00:00.000Z",
    type: "custom_message",
  };
}

function plan(branch: Branch, configuration: TurnFoldConfiguration) {
  return planTranscriptProjection(branch, configuration, {
    activeRun: false,
    attachedCompactionEntryIds: new Set(),
  });
}

function ids(entries: readonly Entry[]): string[] {
  return entries.map((candidate) => candidate.id);
}

describe("transcript projection plans", () => {
  const branch = [entry("before"), entry("latest", "compaction"), entry("after")];

  it("shows pass-through entries for compact, show, and all", () => {
    const result = plan(branch, {
      preCompaction: "show",
      windows: "all",
    });
    expect(ids(result.windowEntries)).toEqual(["before", "latest", "after"]);
    expect(ids(result.sourceEntries)).toEqual(["before", "latest", "after"]);
    expect(ids(result.displayEntries)).toEqual(["before", "latest", "after"]);
  });

  it("starts at the newest compaction when pre-compaction history is hidden", () => {
    const result = plan(branch, {
      preCompaction: "hide",
      windows: "all",
    });
    expect(ids(result.windowEntries)).toEqual(["before", "latest", "after"]);
    expect(ids(result.sourceEntries)).toEqual(["latest", "after"]);
    expect(ids(result.displayEntries)).toEqual(["latest", "after"]);
  });

  it("does not require non-rendering custom metadata to be loaded as a component", () => {
    const metadata: Entry = {
      customType: "onurpi-turn-fold-config",
      data: { preCompaction: "show", windows: "all" },
      id: "config",
      parentId: null,
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "custom",
    };
    const result = plan([entry("visible"), metadata], {
      preCompaction: "show",
      windows: "all",
    });

    expect(canApplyProjectionInPlace(result, new Set(["visible"]))).toBe(true);
  });

  it("requires a restart when third-party custom entries enter or leave the projection", () => {
    const customEntry: Entry = {
      customType: "third-party-renderer",
      data: {},
      id: "custom",
      parentId: null,
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "custom",
    };
    const customBranch = [customEntry, entry("latest", "compaction"), entry("after")];
    const show = plan(customBranch, {
      preCompaction: "show",
      windows: "all",
    });
    const hide = plan(customBranch, {
      preCompaction: "hide",
      windows: "all",
    });

    expect(canApplyProjectionInPlace(show, new Set(["latest", "after"]))).toBe(false);
    expect(canApplyProjectionInPlace(hide, new Set(["custom", "latest", "after"]))).toBe(false);
    expect(canApplyProjectionInPlace(hide, new Set(["latest", "after"]))).toBe(true);
  });

  it("allows only projections whose displayed entries are already loaded", () => {
    const show = plan(branch, {
      preCompaction: "show",
      windows: "all",
    });
    const hide = plan(branch, {
      preCompaction: "hide",
      windows: "all",
    });
    const loaded = new Set(["latest", "after"]);

    expect(canApplyProjectionInPlace(hide, loaded)).toBe(true);
    expect(canApplyProjectionInPlace(hide, new Set(["before", "latest", "after"]))).toBe(false);
    expect(canApplyProjectionInPlace(show, loaded)).toBe(false);
    expect(canApplyProjectionInPlace(show, new Set(["before", "latest", "after"]))).toBe(true);
  });
});
