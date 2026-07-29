import { randomUUID } from "node:crypto";

export const TURN_FOLD_RUN_ENTRY = "onurpi-turn-fold-run";

export type RunBoundary = {
  promptEntryId: string | null;
  runId: string;
  startedAt: number;
  version: 1;
};

type PendingRunBoundary = {
  existingEntryIds: ReadonlySet<string>;
  promptEntryId: string | null;
  runId: string;
  startedAt: number;
};

type AppendEntry = (customType: string, data: RunBoundary) => void;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildRunBoundary(
  value: Readonly<Record<string, unknown>>,
  runId: string | undefined,
  promptEntryId: string | null | undefined,
  startedAt: unknown,
): RunBoundary | undefined {
  if (runId === undefined || promptEntryId === undefined) return undefined;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) {
    return undefined;
  }
  if (!exactKeys(value, ["promptEntryId", "runId", "startedAt", "version"])) return undefined;
  return { promptEntryId, runId, startedAt, version: 1 };
}

export function parseRunBoundary(value: unknown): RunBoundary | undefined {
  if (!isRecord(value) || value["version"] !== 1) return undefined;
  const runId = nonemptyString(value["runId"]);
  const rawPromptEntryId = value["promptEntryId"];
  const promptEntryId = rawPromptEntryId === null ? null : nonemptyString(rawPromptEntryId);
  const startedAt = value["startedAt"];
  return buildRunBoundary(value, runId, promptEntryId, startedAt);
}

export function runBoundaryFromEntry(entry: unknown): RunBoundary | undefined {
  if (
    !isRecord(entry) ||
    entry["type"] !== "custom" ||
    entry["customType"] !== TURN_FOLD_RUN_ENTRY
  ) {
    return undefined;
  }
  return parseRunBoundary(entry["data"]);
}

function entryId(entry: unknown): string | undefined {
  return isRecord(entry) ? nonemptyString(entry["id"]) : undefined;
}

function messageRole(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  if (entry["type"] === "custom_message") return "custom";
  if (entry["type"] !== "message") return undefined;
  const message = entry["message"];
  if (!isRecord(message)) return undefined;
  const role = message["role"];
  return typeof role === "string" ? role : undefined;
}

function currentPromptEntryId(entries: readonly unknown[]): string | null {
  const entry = entries.at(-1);
  const role = messageRole(entry);
  return role === "user" || role === "custom" ? (entryId(entry) ?? null) : null;
}

export function promptEntryIdAfter(
  entries: readonly unknown[],
  existingEntryIds: ReadonlySet<string>,
): string | null {
  for (const entry of entries) {
    const id = entryId(entry);
    if (!id || existingEntryIds.has(id)) continue;
    const role = messageRole(entry);
    if (role === "user" || role === "custom") return id;
  }
  return null;
}

export function historicalRunStarts(entries: readonly unknown[]): ReadonlyMap<string, RunBoundary> {
  const entryIds = new Set(entries.map((entry) => entryId(entry)).filter((id) => id !== undefined));
  const starts = new Map<string, RunBoundary>();
  for (const entry of entries) {
    const boundary = runBoundaryFromEntry(entry);
    const boundaryEntryId = entryId(entry);
    if (!boundary || !boundaryEntryId) continue;
    const anchor =
      boundary.promptEntryId && entryIds.has(boundary.promptEntryId)
        ? boundary.promptEntryId
        : boundaryEntryId;
    starts.set(anchor, boundary);
  }
  return starts;
}

function entryIndexById(entries: readonly unknown[], id: string): number | undefined {
  const index = entries.findIndex((entry) => entryId(entry) === id);
  return index >= 0 ? index : undefined;
}

export function nearestRunStartIndex(
  entries: readonly unknown[],
  beforeIndex: number,
): number | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const boundary = runBoundaryFromEntry(entry);
    if (boundary) {
      if (boundary.promptEntryId) {
        const promptIndex = entryIndexById(entries, boundary.promptEntryId);
        if (promptIndex !== undefined && promptIndex < beforeIndex) return promptIndex;
      }
      return index;
    }
    if (messageRole(entry) === "user") return index;
  }
  return undefined;
}

export function branchEntryIds(entries: readonly unknown[]): ReadonlySet<string> {
  return new Set(entries.map((entry) => entryId(entry)).filter((id) => id !== undefined));
}

export class RunBoundaryRecorder {
  private readonly appendEntry: AppendEntry;
  private pending: PendingRunBoundary | undefined;

  constructor(appendEntry: AppendEntry) {
    this.appendEntry = appendEntry;
  }

  start(entries: readonly unknown[], startedAt = Date.now(), runId: string = randomUUID()): void {
    if (this.pending) return;
    this.pending = {
      existingEntryIds: branchEntryIds(entries),
      promptEntryId: currentPromptEntryId(entries),
      runId,
      startedAt,
    };
  }

  persist(entries: readonly unknown[]): RunBoundary | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    this.pending = undefined;
    const boundary: RunBoundary = {
      promptEntryId: pending.promptEntryId ?? promptEntryIdAfter(entries, pending.existingEntryIds),
      runId: pending.runId,
      startedAt: pending.startedAt,
      version: 1,
    };
    this.appendEntry(TURN_FOLD_RUN_ENTRY, boundary);
    return boundary;
  }

  reset(): void {
    this.pending = undefined;
  }
}
