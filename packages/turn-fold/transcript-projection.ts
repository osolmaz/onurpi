import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { historicalRunStarts } from "./run-boundary.ts";
import { assistantSnapshot, messageFromEntry, stringField } from "./turn-message.ts";

export const DEFAULT_PROJECTED_COMPONENT_LIMIT = 512;

const MANAGED_MESSAGE_ROLES = new Set(["assistant", "toolResult", "user"]);

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

type ProjectedAssistant = {
  entry: BranchEntry;
  snapshot: NonNullable<ReturnType<typeof assistantSnapshot>>;
};

type ProjectedActivity =
  | { assistant: ProjectedAssistant; kind: "assistant" }
  | { assistant: ProjectedAssistant; kind: "tool"; toolCallId: string };

type ProjectedRun = {
  activities: ProjectedActivity[];
  assistants: ProjectedAssistant[];
  entries: BranchEntry[];
  promptEntry: BranchEntry | undefined;
  toolResults: Map<string, BranchEntry>;
};

type RunDisplayUnit = {
  componentCount: number;
  entries: BranchEntry[];
  kind: "run";
  run: ProjectedRun;
};

type StandaloneDisplayUnit = {
  componentCount: number;
  entries: BranchEntry[];
  kind: "standalone";
};

type DisplayUnit = RunDisplayUnit | StandaloneDisplayUnit;

export type TranscriptProjectionOptions = {
  activeRun: boolean;
  attachedCompactionEntryIds: ReadonlySet<string>;
  componentLimit?: number;
};

export type TranscriptProjection = {
  displayEntries: BranchEntries;
  omittedRunCount: number;
  oldestRetainedEntryId?: string;
  projectedComponentCount: number;
  sourceEntries: BranchEntries;
};

function entryId(entry: unknown): string | undefined {
  return stringField(entry, "id");
}

function entryType(entry: unknown): string | undefined {
  return stringField(entry, "type");
}

function messageRole(entry: unknown): string | undefined {
  return stringField(messageFromEntry(entry), "role");
}

function startsRun(entry: BranchEntry, runStarts: ReadonlyMap<string, unknown>): boolean {
  const id = entryId(entry);
  return (id !== undefined && runStarts.has(id)) || messageRole(entry) === "user";
}

function createRun(): ProjectedRun {
  return {
    activities: [],
    assistants: [],
    entries: [],
    promptEntry: undefined,
    toolResults: new Map(),
  };
}

function indexToolResult(run: ProjectedRun, entry: BranchEntry, message: unknown): void {
  const toolCallId = stringField(message, "toolCallId");
  if (toolCallId) run.toolResults.set(toolCallId, entry);
}

function indexAssistant(
  run: ProjectedRun,
  entry: BranchEntry,
  message: unknown,
  assistantOrdinal: number,
): number {
  const snapshot = assistantSnapshot(message, `projection:${String(assistantOrdinal)}`);
  if (!snapshot) return assistantOrdinal;
  const assistant = { entry, snapshot };
  run.assistants.push(assistant);
  if (snapshot.hasVisibleContent) run.activities.push({ assistant, kind: "assistant" });
  for (const toolCallId of snapshot.toolCallIds) {
    run.activities.push({ assistant, kind: "tool", toolCallId });
  }
  return assistantOrdinal + 1;
}

function indexRunEntry(run: ProjectedRun, entry: BranchEntry, assistantOrdinal: number): number {
  run.entries.push(entry);
  const message = messageFromEntry(entry);
  const role = stringField(message, "role");
  if ((role === "user" || entryType(entry) === "custom_message") && !run.promptEntry) {
    run.promptEntry = entry;
  }
  if (role === "toolResult") indexToolResult(run, entry, message);
  return role === "assistant"
    ? indexAssistant(run, entry, message, assistantOrdinal)
    : assistantOrdinal;
}

function groupEntries(entries: BranchEntries): {
  outsideRuns: BranchEntry[];
  runs: ProjectedRun[];
} {
  const runStarts = historicalRunStarts(entries);
  const outsideRuns: BranchEntry[] = [];
  const runs: ProjectedRun[] = [];
  let currentRun: ProjectedRun | undefined;
  let assistantOrdinal = 0;

  for (const entry of entries) {
    if (startsRun(entry, runStarts)) {
      currentRun = createRun();
      runs.push(currentRun);
    }
    const role = messageRole(entry);
    if (!currentRun && (role === "assistant" || role === "toolResult")) {
      currentRun = createRun();
      runs.push(currentRun);
    }
    if (!currentRun) {
      outsideRuns.push(entry);
      continue;
    }
    assistantOrdinal = indexRunEntry(currentRun, entry, assistantOrdinal);
  }
  return { outsideRuns, runs };
}

function keepToolActivity(
  keep: Set<string>,
  run: ProjectedRun,
  assistant: ProjectedAssistant,
): void {
  const assistantId = entryId(assistant.entry);
  if (assistantId) keep.add(assistantId);
  for (const toolCallId of assistant.snapshot.toolCallIds) {
    const resultId = entryId(run.toolResults.get(toolCallId));
    if (resultId) keep.add(resultId);
  }
}

function latestDisplayableAssistant(run: ProjectedRun): ProjectedAssistant | undefined {
  for (let index = run.assistants.length - 1; index >= 0; index -= 1) {
    const assistant = run.assistants[index];
    if (
      assistant &&
      (assistant.snapshot.hasVisibleContent || assistant.snapshot.hasTerminalNotice)
    ) {
      return assistant;
    }
  }
  return undefined;
}

function latestToolCallId(run: ProjectedRun): string | undefined {
  for (let index = run.assistants.length - 1; index >= 0; index -= 1) {
    const toolCallId = run.assistants[index]?.snapshot.toolCallIds.at(-1);
    if (toolCallId) return toolCallId;
  }
  return undefined;
}

function assistantForTool(run: ProjectedRun, toolCallId: string): ProjectedAssistant | undefined {
  for (let index = run.assistants.length - 1; index >= 0; index -= 1) {
    const assistant = run.assistants[index];
    if (assistant?.snapshot.toolCallIds.includes(toolCallId)) return assistant;
  }
  return undefined;
}

function finalToolCallId(run: ProjectedRun): string | undefined {
  const terminalErrors = run.assistants.at(-1)?.snapshot.terminalErrorToolCallIds ?? [];
  return (
    terminalErrors.at(-1) ?? (latestDisplayableAssistant(run) ? undefined : latestToolCallId(run))
  );
}

function activeRunEntryIds(run: ProjectedRun, keep: Set<string>): Set<string> {
  const seenAssistants = new Set<ProjectedAssistant>();
  let remainingActivities = 3;
  for (let index = run.activities.length - 1; index >= 0; index -= 1) {
    const assistant = run.activities[index]?.assistant;
    if (!assistant || seenAssistants.has(assistant)) continue;
    seenAssistants.add(assistant);
    const activityCount =
      assistant.snapshot.toolCallIds.length + (assistant.snapshot.hasVisibleContent ? 1 : 0);
    if (activityCount > remainingActivities) continue;
    keepToolActivity(keep, run, assistant);
    remainingActivities -= activityCount;
    if (remainingActivities === 0) break;
  }
  return keep;
}

function compactRunEntryIds(run: ProjectedRun, active: boolean): Set<string> {
  const keep = promptOnlyEntryIds(run);
  if (active) return activeRunEntryIds(run, keep);

  const finalTool = finalToolCallId(run);
  const toolAssistant = finalTool ? assistantForTool(run, finalTool) : undefined;
  if (toolAssistant) keepToolActivity(keep, run, toolAssistant);
  else {
    const assistantId = entryId(latestDisplayableAssistant(run)?.entry);
    if (assistantId) keep.add(assistantId);
  }
  return keep;
}

function isManagedMessage(entry: BranchEntry): boolean {
  const role = messageRole(entry);
  return role === "assistant" || role === "toolResult" || role === "user";
}

function shouldPassThrough(
  entry: BranchEntry,
  attachedCompactionEntryIds: ReadonlySet<string>,
): boolean {
  if (isManagedMessage(entry)) return false;
  if (
    entryType(entry) === "custom" &&
    ["onurpi-turn-fold-config", "onurpi-turn-fold-run"].includes(
      stringField(entry, "customType") ?? "",
    )
  ) {
    return false;
  }
  if (entryType(entry) !== "compaction") return true;
  const id = entryId(entry);
  return id === undefined || !attachedCompactionEntryIds.has(id);
}

function estimatedComponents(run: ProjectedRun, keptIds: ReadonlySet<string>): number {
  let count = 0;
  for (const assistant of run.assistants) {
    const id = entryId(assistant.entry);
    if (!id || !keptIds.has(id)) continue;
    count += 1 + assistant.snapshot.toolCallIds.length;
  }
  return count + (run.promptEntry ? 1 : 0);
}

function entryOwners(runs: readonly ProjectedRun[]): ReadonlyMap<BranchEntry, ProjectedRun> {
  const owners = new Map<BranchEntry, ProjectedRun>();
  for (const run of runs) for (const entry of run.entries) owners.set(entry, run);
  return owners;
}

function isNativePassThroughComponent(
  entry: BranchEntry,
  attachedCompactionEntryIds: ReadonlySet<string>,
): boolean {
  const type = entryType(entry);
  if (type === "branch_summary") return true;
  if (type === "message") return !MANAGED_MESSAGE_ROLES.has(messageRole(entry) ?? "");
  if (type === "custom") {
    return !["onurpi-turn-fold-config", "onurpi-turn-fold-run"].includes(
      stringField(entry, "customType") ?? "",
    );
  }
  const id = entryId(entry);
  return type === "compaction" && (id === undefined || !attachedCompactionEntryIds.has(id));
}

function isPassThroughComponent(
  entry: BranchEntry,
  owner: ProjectedRun | undefined,
  attachedCompactionEntryIds: ReadonlySet<string>,
): boolean {
  if (entryType(entry) === "custom_message") return owner?.promptEntry !== entry;
  return isNativePassThroughComponent(entry, attachedCompactionEntryIds);
}

function promptOnlyEntryIds(run: ProjectedRun): Set<string> {
  const keep = new Set<string>();
  const promptId = entryId(run.promptEntry);
  if (promptId) keep.add(promptId);
  return keep;
}

function runDisplayUnit(
  run: ProjectedRun,
  active: boolean,
  attachedCompactionEntryIds: ReadonlySet<string>,
): RunDisplayUnit {
  const managedEntryIds = compactRunEntryIds(run, active);
  const unitEntries: BranchEntry[] = [];
  let passThroughComponents = 0;

  for (const entry of run.entries) {
    const id = entryId(entry);
    if (id !== undefined && managedEntryIds.has(id)) {
      unitEntries.push(entry);
      continue;
    }
    if (!shouldPassThrough(entry, attachedCompactionEntryIds)) continue;
    unitEntries.push(entry);
    if (isPassThroughComponent(entry, run, attachedCompactionEntryIds)) {
      passThroughComponents += 1;
    }
  }

  return {
    componentCount: estimatedComponents(run, managedEntryIds) + passThroughComponents,
    entries: unitEntries,
    kind: "run",
    run,
  };
}

function standaloneDisplayUnit(
  entry: BranchEntry,
  attachedCompactionEntryIds: ReadonlySet<string>,
): StandaloneDisplayUnit {
  return {
    componentCount: isPassThroughComponent(entry, undefined, attachedCompactionEntryIds) ? 1 : 0,
    entries: [entry],
    kind: "standalone",
  };
}

function displayUnits(
  entries: BranchEntries,
  runs: readonly ProjectedRun[],
  owners: ReadonlyMap<BranchEntry, ProjectedRun>,
  activeRun: boolean,
  attachedCompactionEntryIds: ReadonlySet<string>,
): DisplayUnit[] {
  const runByFirstEntry = new Map<BranchEntry, ProjectedRun>();
  for (const run of runs) {
    const firstEntry = run.entries[0];
    if (firstEntry) runByFirstEntry.set(firstEntry, run);
  }

  const units: DisplayUnit[] = [];
  const newestRun = runs.at(-1);
  for (const entry of entries) {
    const run = runByFirstEntry.get(entry);
    if (run) {
      units.push(runDisplayUnit(run, activeRun && run === newestRun, attachedCompactionEntryIds));
      continue;
    }
    if (owners.has(entry) || !shouldPassThrough(entry, attachedCompactionEntryIds)) continue;
    units.push(standaloneDisplayUnit(entry, attachedCompactionEntryIds));
  }
  return units;
}

type RetainedDisplay = {
  entries: ReadonlySet<BranchEntry>;
  omittedRunCount: number;
  oldestRetainedEntryId: string | undefined;
  projectedComponentCount: number;
};

function addUnitEntries(target: Set<BranchEntry>, unit: DisplayUnit): void {
  for (const entry of unit.entries) target.add(entry);
}

function oldestRetainedRunEntryId(
  units: readonly DisplayUnit[],
  retainedRuns: ReadonlySet<ProjectedRun>,
): string | undefined {
  for (const unit of units) {
    if (unit.kind !== "run" || !retainedRuns.has(unit.run)) continue;
    const promptId = entryId(unit.run.promptEntry);
    if (promptId) return promptId;
  }
  return undefined;
}

function countRunUnits(units: readonly DisplayUnit[], lastIndex: number): number {
  let count = 0;
  for (let index = 0; index <= lastIndex; index += 1) {
    if (units[index]?.kind === "run") count += 1;
  }
  return count;
}

function oversizedNewestFallback(
  unit: DisplayUnit,
  newestRun: RunDisplayUnit | undefined,
  projectedComponentCount: number,
  componentLimit: number,
): RunDisplayUnit | undefined {
  if (unit.kind !== "run" || unit !== newestRun) return undefined;
  if (projectedComponentCount > 0 || unit.componentCount <= componentLimit) return undefined;
  return unit;
}

function retainDisplaySuffix(
  units: readonly DisplayUnit[],
  componentLimit: number,
): RetainedDisplay {
  const entries = new Set<BranchEntry>();
  const retainedRuns = new Set<ProjectedRun>();
  const newestRun = [...units].reverse().find((unit) => unit.kind === "run");
  let projectedComponentCount = 0;
  let lastOmittedUnitIndex = -1;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) continue;
    if (projectedComponentCount + unit.componentCount <= componentLimit) {
      addUnitEntries(entries, unit);
      projectedComponentCount += unit.componentCount;
      if (unit.kind === "run") retainedRuns.add(unit.run);
      continue;
    }

    const fallback = oversizedNewestFallback(
      unit,
      newestRun,
      projectedComponentCount,
      componentLimit,
    );
    if (fallback?.run.promptEntry) {
      entries.add(fallback.run.promptEntry);
      retainedRuns.add(fallback.run);
      projectedComponentCount = 1;
      lastOmittedUnitIndex = index - 1;
    } else {
      lastOmittedUnitIndex = index;
    }
    break;
  }

  return {
    entries,
    omittedRunCount: countRunUnits(units, lastOmittedUnitIndex),
    oldestRetainedEntryId: oldestRetainedRunEntryId(units, retainedRuns),
    projectedComponentCount,
  };
}

export function projectTranscriptEntries(
  entries: BranchEntries,
  options: TranscriptProjectionOptions,
): TranscriptProjection {
  const sourceEntries = [...entries];
  const { runs } = groupEntries(sourceEntries);
  const componentLimit = Math.max(1, options.componentLimit ?? DEFAULT_PROJECTED_COMPONENT_LIMIT);
  const owners = entryOwners(runs);
  const units = displayUnits(
    sourceEntries,
    runs,
    owners,
    options.activeRun,
    options.attachedCompactionEntryIds,
  );
  const retained = retainDisplaySuffix(units, componentLimit);
  const displayEntries = sourceEntries.filter((entry) => retained.entries.has(entry));
  return {
    displayEntries,
    omittedRunCount: retained.omittedRunCount,
    projectedComponentCount: retained.projectedComponentCount,
    sourceEntries,
    ...(retained.oldestRetainedEntryId === undefined
      ? {}
      : { oldestRetainedEntryId: retained.oldestRetainedEntryId }),
  };
}
