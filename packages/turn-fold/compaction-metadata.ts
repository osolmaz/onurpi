export const COMPACTION_METADATA_ENTRY_TYPE = "onurpi-turn-fold-compaction";

export type CompactionReason = "manual" | "overflow" | "threshold";

export type CompactionMetadata = {
  attachedToTurn: boolean;
  compactionEntryId: string;
  reason: CompactionReason;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isCompactionReason(value: unknown): value is CompactionReason {
  return value === "manual" || value === "overflow" || value === "threshold";
}

function isMetadataEntry(entry: unknown): entry is Readonly<Record<string, unknown>> {
  return (
    isRecord(entry) &&
    entry["type"] === "custom" &&
    entry["customType"] === COMPACTION_METADATA_ENTRY_TYPE
  );
}

function metadataFromData(data: unknown): CompactionMetadata | undefined {
  if (!isRecord(data)) return undefined;
  const attachedToTurn = data["attachedToTurn"];
  const compactionEntryId = data["compactionEntryId"];
  const reason = data["reason"];
  if (
    typeof attachedToTurn !== "boolean" ||
    typeof compactionEntryId !== "string" ||
    compactionEntryId.length === 0 ||
    !isCompactionReason(reason) ||
    (attachedToTurn && reason === "manual")
  ) {
    return undefined;
  }
  return { attachedToTurn, compactionEntryId, reason };
}

export function compactionMetadataFromEntry(entry: unknown): CompactionMetadata | undefined {
  return isMetadataEntry(entry) ? metadataFromData(entry["data"]) : undefined;
}

export function compactionMetadataById(
  entries: readonly unknown[],
): ReadonlyMap<string, CompactionMetadata> {
  const result = new Map<string, CompactionMetadata>();
  for (const entry of entries) {
    const metadata = compactionMetadataFromEntry(entry);
    if (metadata) result.set(metadata.compactionEntryId, metadata);
  }
  return result;
}
