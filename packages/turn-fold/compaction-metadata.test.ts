import { describe, expect, it } from "vitest";

import {
  COMPACTION_METADATA_ENTRY_TYPE,
  compactionMetadataById,
  compactionMetadataFromEntry,
} from "./compaction-metadata.ts";

function metadataEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customType: COMPACTION_METADATA_ENTRY_TYPE,
    data: {
      attachedToTurn: true,
      compactionEntryId: "compact-1",
      reason: "overflow",
      ...overrides,
    },
    type: "custom",
  };
}

describe("compaction metadata", () => {
  it("parses persisted turn associations", () => {
    expect(compactionMetadataFromEntry(metadataEntry())).toEqual({
      attachedToTurn: true,
      compactionEntryId: "compact-1",
      reason: "overflow",
    });
    expect(
      compactionMetadataFromEntry(metadataEntry({ attachedToTurn: false, reason: "manual" })),
    ).toEqual({
      attachedToTurn: false,
      compactionEntryId: "compact-1",
      reason: "manual",
    });
  });

  it("ignores unrelated and malformed entries", () => {
    expect(compactionMetadataFromEntry(undefined)).toBeUndefined();
    expect(compactionMetadataFromEntry({ type: "message" })).toBeUndefined();
    expect(
      compactionMetadataFromEntry({
        customType: "other",
        data: {},
        type: "custom",
      }),
    ).toBeUndefined();
    expect(
      compactionMetadataFromEntry({
        customType: COMPACTION_METADATA_ENTRY_TYPE,
        type: "custom",
      }),
    ).toBeUndefined();
    expect(compactionMetadataFromEntry(metadataEntry({ attachedToTurn: "yes" }))).toBeUndefined();
    expect(compactionMetadataFromEntry(metadataEntry({ compactionEntryId: 1 }))).toBeUndefined();
    expect(compactionMetadataFromEntry(metadataEntry({ compactionEntryId: "" }))).toBeUndefined();
    expect(compactionMetadataFromEntry(metadataEntry({ reason: "unknown" }))).toBeUndefined();
    expect(compactionMetadataFromEntry(metadataEntry({ reason: "manual" }))).toBeUndefined();
  });

  it("indexes the latest valid metadata by compaction ID", () => {
    const entries = [
      metadataEntry({ reason: "threshold" }),
      { type: "other" },
      metadataEntry({ attachedToTurn: false, reason: "manual" }),
    ];

    expect(compactionMetadataById(entries).get("compact-1")).toEqual({
      attachedToTurn: false,
      compactionEntryId: "compact-1",
      reason: "manual",
    });
  });
});
