import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PRE_COMPACTION_VALUES = ["show", "hide"] as const;

export type PreCompactionVisibility = (typeof PRE_COMPACTION_VALUES)[number];

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isCompaction(entry: unknown): boolean {
  return isRecord(entry) && entry["type"] === "compaction";
}

export function isPreCompactionVisibility(value: unknown): value is PreCompactionVisibility {
  return PRE_COMPACTION_VALUES.some((candidate) => candidate === value);
}

export function nextPreCompactionVisibility(
  value: PreCompactionVisibility,
): PreCompactionVisibility {
  return value === "show" ? "hide" : "show";
}

export function selectPreCompactionEntries(
  entries: readonly BranchEntry[],
  visibility: PreCompactionVisibility,
): BranchEntries {
  if (visibility === "show") return [...entries];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isCompaction(entries[index])) return entries.slice(index);
  }
  return [...entries];
}
