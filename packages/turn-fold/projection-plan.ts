import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TurnFoldConfiguration } from "./configuration.ts";
import { selectPreCompactionEntries } from "./history-scope.ts";
import { projectTranscriptEntries } from "./transcript-projection.ts";
import { selectTranscriptEntries } from "./transcript-windows.ts";

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

export type TranscriptProjectionPlan = Readonly<{
  displayEntries: BranchEntries;
  hasUnidentifiedDisplayEntries: boolean;
  oldestRetainedEntryId?: string;
  omittedRunCount: number;
  requiredEntryIds: ReadonlySet<string>;
  sourceEntries: BranchEntries;
  windowEntries: BranchEntries;
}>;

type TranscriptProjectionPlanOptions = Readonly<{
  activeRun: boolean;
  attachedCompactionEntryIds: ReadonlySet<string>;
}>;

function entryId(entry: BranchEntry): string | undefined {
  return typeof entry.id === "string" && entry.id.length > 0 ? entry.id : undefined;
}

function requiresLoadedComponent(entry: BranchEntry): boolean {
  return entry.type !== "custom";
}

export function entryIds(entries: readonly BranchEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = entryId(entry);
    if (id) ids.add(id);
  }
  return ids;
}

export function planSelectedTranscriptProjection(
  windowEntries: BranchEntries,
  configuration: TurnFoldConfiguration,
  options: TranscriptProjectionPlanOptions,
): TranscriptProjectionPlan {
  const sourceEntries = selectPreCompactionEntries(windowEntries, configuration.preCompaction);
  const projection = projectTranscriptEntries(sourceEntries, {
    activeRun: options.activeRun,
    attachedCompactionEntryIds: options.attachedCompactionEntryIds,
    density: configuration.density,
  });
  const componentEntries = projection.displayEntries.filter(requiresLoadedComponent);
  const requiredEntryIds = entryIds(componentEntries);
  return {
    displayEntries: projection.displayEntries,
    hasUnidentifiedDisplayEntries: requiredEntryIds.size !== componentEntries.length,
    oldestRetainedEntryId: projection.oldestRetainedEntryId,
    omittedRunCount: projection.omittedRunCount,
    requiredEntryIds,
    sourceEntries: projection.sourceEntries,
    windowEntries,
  };
}

export function planTranscriptProjection(
  branch: BranchEntries,
  configuration: TurnFoldConfiguration,
  options: TranscriptProjectionPlanOptions,
): TranscriptProjectionPlan {
  return planSelectedTranscriptProjection(
    selectTranscriptEntries(branch, configuration.windows),
    configuration,
    options,
  );
}

export function canApplyProjectionInPlace(
  plan: TranscriptProjectionPlan,
  loadedEntryIds: ReadonlySet<string>,
): boolean {
  if (plan.hasUnidentifiedDisplayEntries) return false;
  for (const id of plan.requiredEntryIds) {
    if (!loadedEntryIds.has(id)) return false;
  }
  return true;
}
