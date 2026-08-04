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

function boundedPassThroughEntries(
  entries: BranchEntries,
  owners: ReadonlyMap<BranchEntry, ProjectedRun>,
  attachedCompactionEntryIds: ReadonlySet<string>,
  componentLimit: number,
): ReadonlySet<BranchEntry> {
  const candidates = entries.filter((entry) =>
    isPassThroughComponent(entry, owners.get(entry), attachedCompactionEntryIds),
  );
  return new Set(candidates.slice(-componentLimit));
}

function promptOnlyEntryIds(run: ProjectedRun): Set<string> {
  const keep = new Set<string>();
  const promptId = entryId(run.promptEntry);
  if (promptId) keep.add(promptId);
  return keep;
}

function boundedRunEntryIds(
  run: ProjectedRun,
  active: boolean,
  componentLimit: number,
): Set<string> {
  if (componentLimit <= 0) return new Set();
  const keep = compactRunEntryIds(run, active);
  const fallback = promptOnlyEntryIds(run);
  return estimatedComponents(run, keep) <= componentLimit ? keep : fallback;
}

function retainedRuns(
  runs: readonly ProjectedRun[],
  activeRun: boolean,
  componentLimit: number,
): { keepByRun: Map<ProjectedRun, Set<string>>; omittedRunCount: number } {
  const keepByRun = new Map<ProjectedRun, Set<string>>();
  let components = 0;
  let omittedRunCount = 0;

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run) continue;
    const keep = boundedRunEntryIds(run, activeRun && index === runs.length - 1, componentLimit);
    const nextComponents = estimatedComponents(run, keep);
    if (nextComponents === 0 || components + nextComponents > componentLimit) {
      omittedRunCount += 1;
      continue;
    }
    keepByRun.set(run, keep);
    components += nextComponents;
  }
  return { keepByRun, omittedRunCount };
}

function isKeptRunEntry(
  run: ProjectedRun | undefined,
  id: string | undefined,
  keepByRun: ReadonlyMap<ProjectedRun, ReadonlySet<string>>,
): boolean {
  return run !== undefined && id !== undefined && keepByRun.get(run)?.has(id) === true;
}

function shouldProjectEntry(
  entry: BranchEntry,
  run: ProjectedRun | undefined,
  keepByRun: ReadonlyMap<ProjectedRun, ReadonlySet<string>>,
  allowedPassThroughEntries: ReadonlySet<BranchEntry>,
  attachedCompactionEntryIds: ReadonlySet<string>,
): boolean {
  if (isKeptRunEntry(run, entryId(entry), keepByRun)) return true;
  if (isPassThroughComponent(entry, run, attachedCompactionEntryIds)) {
    return allowedPassThroughEntries.has(entry);
  }
  if (entryType(entry) === "custom_message" && run?.promptEntry === entry) return false;
  return shouldPassThrough(entry, attachedCompactionEntryIds);
}

function projectedEntries(
  entries: BranchEntries,
  owners: ReadonlyMap<BranchEntry, ProjectedRun>,
  keepByRun: ReadonlyMap<ProjectedRun, ReadonlySet<string>>,
  allowedPassThroughEntries: ReadonlySet<BranchEntry>,
  attachedCompactionEntryIds: ReadonlySet<string>,
): BranchEntries {
  return entries.filter((entry) =>
    shouldProjectEntry(
      entry,
      owners.get(entry),
      keepByRun,
      allowedPassThroughEntries,
      attachedCompactionEntryIds,
    ),
  );
}

function oldestRetainedRunEntryId(
  runs: readonly ProjectedRun[],
  keepByRun: ReadonlyMap<ProjectedRun, ReadonlySet<string>>,
): string | undefined {
  for (const run of runs) {
    const keep = keepByRun.get(run);
    if (!keep) continue;
    const promptId = entryId(run.promptEntry);
    if (promptId && keep.has(promptId)) return promptId;
    for (const entry of run.entries) {
      const id = entryId(entry);
      if (id && keep.has(id)) return id;
    }
  }
  return undefined;
}

export function projectTranscriptEntries(
  entries: BranchEntries,
  options: TranscriptProjectionOptions,
): TranscriptProjection {
  const sourceEntries = [...entries];
  const { runs } = groupEntries(sourceEntries);
  const componentLimit = Math.max(1, options.componentLimit ?? DEFAULT_PROJECTED_COMPONENT_LIMIT);
  const owners = entryOwners(runs);
  const allowedPassThroughEntries = boundedPassThroughEntries(
    sourceEntries,
    owners,
    options.attachedCompactionEntryIds,
    componentLimit,
  );
  const passThroughComponents = allowedPassThroughEntries.size;
  const runComponentLimit = componentLimit - passThroughComponents;
  const { keepByRun, omittedRunCount } = retainedRuns(runs, options.activeRun, runComponentLimit);
  const displayEntries = projectedEntries(
    sourceEntries,
    owners,
    keepByRun,
    allowedPassThroughEntries,
    options.attachedCompactionEntryIds,
  );
  const projectedComponentCount =
    passThroughComponents +
    [...keepByRun].reduce((count, [run, keep]) => count + estimatedComponents(run, keep), 0);
  const oldestRetainedEntryId = oldestRetainedRunEntryId(runs, keepByRun);
  return {
    displayEntries,
    omittedRunCount,
    projectedComponentCount,
    sourceEntries,
    ...(oldestRetainedEntryId === undefined ? {} : { oldestRetainedEntryId }),
  };
}
