import { TURN_FOLD_CONFIG_ENTRY } from "./configuration.ts";
import { TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import { stringField } from "./turn-message.ts";

export const DEFAULT_HISTORY_WINDOW_BATCH = 3;

export type HistoryIndex = Readonly<{
  entries: readonly unknown[];
  totalWindows: number;
  windowStarts: readonly number[];
}>;

function isInternalTurnFoldEntry(entry: unknown): boolean {
  if (stringField(entry, "type") !== "custom") return false;
  const customType = stringField(entry, "customType");
  return customType === TURN_FOLD_CONFIG_ENTRY || customType === TURN_FOLD_RUN_ENTRY;
}

export function historyDisplayEntries(entries: readonly unknown[]): readonly unknown[] {
  return entries.filter((entry) => !isInternalTurnFoldEntry(entry));
}

export function createHistoryIndex(entries: readonly unknown[]): HistoryIndex {
  const displayEntries = historyDisplayEntries(entries);
  const windowStarts = [0];
  displayEntries.forEach((entry, entryIndex) => {
    if (stringField(entry, "type") === "compaction") windowStarts.push(entryIndex);
  });
  return {
    entries: displayEntries,
    totalWindows: windowStarts.length,
    windowStarts,
  };
}

export function historyStartIndex(index: HistoryIndex, newestWindows: number): number {
  const admittedWindows = Math.max(1, Math.min(index.totalWindows, newestWindows));
  return index.windowStarts[index.totalWindows - admittedWindows] ?? 0;
}

export class HistoryRange {
  private admittedWindowCount: number;
  readonly batchWindows: number;
  readonly index: HistoryIndex;

  constructor(index: HistoryIndex, batchWindows = DEFAULT_HISTORY_WINDOW_BATCH) {
    this.index = index;
    this.batchWindows = Math.max(1, Math.floor(batchWindows));
    this.admittedWindowCount = Math.min(index.totalWindows, this.batchWindows);
  }

  get admittedWindows(): number {
    return this.admittedWindowCount;
  }

  get startIndex(): number {
    return historyStartIndex(this.index, this.admittedWindowCount);
  }

  loadOlder(): boolean {
    const next = Math.min(this.index.totalWindows, this.admittedWindowCount + this.batchWindows);
    if (next === this.admittedWindowCount) return false;
    this.admittedWindowCount = next;
    return true;
  }
}
