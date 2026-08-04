import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { TURN_FOLD_CONFIG_ENTRY, type TurnFoldConfiguration } from "./configuration.ts";
import { selectPreCompactionEntries } from "./history-scope.ts";
import { TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import { projectTranscriptEntries } from "./transcript-projection.ts";
import { selectTranscriptEntries } from "./transcript-windows.ts";

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

export type TranscriptProjectionPlan = Readonly<{
  displayEntries: BranchEntries;
  hasUnidentifiedDisplayEntries: boolean;
  oldestRetainedEntryId: string | undefined;
  omittedRunCount: number;
  omittedUnpatchableEntryIds: ReadonlySet<string>;
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

function isUnpatchableCustomEntry(entry: BranchEntry): boolean {
  return (
    entry.type === "custom" &&
    entry.customType !== TURN_FOLD_CONFIG_ENTRY &&
    entry.customType !== TURN_FOLD_RUN_ENTRY
  );
}

function requiresLoadedComponent(entry: BranchEntry): boolean {
  return entry.type !== "custom" || isUnpatchableCustomEntry(entry);
}

function omittedUnpatchableEntryIds(
  entries: BranchEntries,
  displayEntryIds: ReadonlySet<string>,
): Set<string> {
  const omitted = new Set<string>();
  for (const entry of entries) {
    const id = entryId(entry);
    if (isUnpatchableCustomEntry(entry) && id && !displayEntryIds.has(id)) omitted.add(id);
  }
  return omitted;
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
    omittedUnpatchableEntryIds: omittedUnpatchableEntryIds(
      windowEntries,
      entryIds(projection.displayEntries),
    ),
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
  const plan = planSelectedTranscriptProjection(
    selectTranscriptEntries(branch, configuration.windows),
    configuration,
    options,
  );
  return {
    ...plan,
    omittedUnpatchableEntryIds: omittedUnpatchableEntryIds(branch, entryIds(plan.displayEntries)),
  };
}

export function canApplyProjectionInPlace(
  plan: TranscriptProjectionPlan,
  loadedEntryIds: ReadonlySet<string>,
): boolean {
  if (plan.hasUnidentifiedDisplayEntries) return false;
  for (const id of plan.omittedUnpatchableEntryIds) {
    if (loadedEntryIds.has(id)) return false;
  }
  for (const id of plan.requiredEntryIds) {
    if (!loadedEntryIds.has(id)) return false;
  }
  return true;
}
