import type { HistoryIndex } from "./history-index.ts";
import { historyEntryPresentation } from "./history-entry.ts";
import type { HistorySearchMatch } from "./history-search.ts";

const DEFAULT_NAVIGATION_LIMIT = 32;

export type HistoryJumpTarget =
  | Readonly<{ kind: "match" | "turn" | "window"; number: number }>
  | Readonly<{ kind: "newest" | "oldest" }>
  | Readonly<{ kind: "timestamp"; value: string }>;

export type HistoryJumpResult =
  | Readonly<{ entryIndex: number; label: string; ok: true }>
  | Readonly<{ error: string; ok: false }>;

export class BoundedNavigationHistory<T> {
  private readonly backward: T[] = [];
  private readonly forward: T[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_NAVIGATION_LIMIT) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get backwardCount(): number {
    return this.backward.length;
  }

  get forwardCount(): number {
    return this.forward.length;
  }

  record(position: T): void {
    this.backward.push(position);
    while (this.backward.length > this.limit) this.backward.shift();
    this.forward.length = 0;
  }

  back(current: T): T | undefined {
    const target = this.backward.pop();
    if (target === undefined) return undefined;
    this.forward.push(current);
    while (this.forward.length > this.limit) this.forward.shift();
    return target;
  }

  next(current: T): T | undefined {
    const target = this.forward.pop();
    if (target === undefined) return undefined;
    this.backward.push(current);
    while (this.backward.length > this.limit) this.backward.shift();
    return target;
  }
}

const NUMBERED_JUMP_KINDS: Readonly<Record<string, "match" | "turn" | "window">> = {
  m: "match",
  match: "match",
  t: "turn",
  turn: "turn",
  w: "window",
  window: "window",
};

function numberedJump(normalized: string): HistoryJumpTarget | undefined {
  const match = /^(?:([wtm])(\d+)|(window|turn|match)\s+(\d+))$/u.exec(normalized);
  if (!match) return undefined;
  const kind = NUMBERED_JUMP_KINDS[match[1] ?? match[3] ?? ""];
  const number = Number(match[2] ?? match[4]);
  if (!kind || !Number.isSafeInteger(number) || number < 1) return undefined;
  return { kind, number };
}

export function parseHistoryJump(value: string): HistoryJumpTarget | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "oldest" || normalized === "newest") return { kind: normalized };
  if (normalized.startsWith("@") && normalized.length > 1) {
    return { kind: "timestamp", value: normalized.slice(1) };
  }
  return numberedJump(normalized);
}

function minuteOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function parsedTimestamp(value: string): { minute: number } | { timestamp: number } | undefined {
  const time = /^(\d{1,2}):(\d{2})$/u.exec(value);
  if (time) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    if (hour < 24 && minute < 60) return { minute: hour * 60 + minute };
    return undefined;
  }
  if (/^\d+$/u.test(value)) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? { timestamp } : undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { timestamp } : undefined;
}

function nearestTimestamp(
  entries: readonly unknown[],
  value: string,
): { entryIndex: number; timestamp: number } | undefined {
  const target = parsedTimestamp(value);
  if (!target) return undefined;
  let nearest: { distance: number; entryIndex: number; timestamp: number } | undefined;
  entries.forEach((entry, entryIndex) => {
    const timestamp = historyEntryPresentation(entry).timestamp;
    if (timestamp === undefined) return;
    const distance =
      "minute" in target
        ? Math.abs(minuteOfDay(timestamp) - target.minute)
        : Math.abs(timestamp - target.timestamp);
    if (!nearest || distance < nearest.distance) nearest = { distance, entryIndex, timestamp };
  });
  return nearest;
}

export class HistoryJumpIndex {
  private readonly index: HistoryIndex;
  private readonly turnStarts: number[];

  constructor(index: HistoryIndex) {
    this.index = index;
    this.turnStarts = index.entries.flatMap((entry, entryIndex) =>
      historyEntryPresentation(entry).kind === "user" ? [entryIndex] : [],
    );
  }

  get totalTurns(): number {
    return this.turnStarts.length;
  }

  resolve(target: HistoryJumpTarget, matches: readonly HistorySearchMatch[]): HistoryJumpResult {
    switch (target.kind) {
      case "oldest":
        return this.success(0, "oldest entry");
      case "newest":
        return this.success(Math.max(0, this.index.entries.length - 1), "newest entry");
      case "window":
        return this.numberedResult("Window", "window", target.number, this.index.windowStarts);
      case "turn":
        return this.numberedResult("Turn", "turn", target.number, this.turnStarts);
      case "match": {
        const entryIndexes = matches.map((match) => match.entryIndex);
        return this.numberedResult("Search match", "match", target.number, entryIndexes);
      }
      case "timestamp":
        return this.timestampResult(target.value);
    }
  }

  private numberedResult(
    errorLabel: string,
    successLabel: string,
    number: number,
    entryIndexes: readonly number[],
  ): HistoryJumpResult {
    const entryIndex = entryIndexes[number - 1];
    return entryIndex === undefined
      ? this.failure(`${errorLabel} ${String(number)} is unavailable.`)
      : this.success(entryIndex, `${successLabel} ${String(number)}`);
  }

  private timestampResult(value: string): HistoryJumpResult {
    const nearest = nearestTimestamp(this.index.entries, value);
    return nearest
      ? this.success(nearest.entryIndex, `timestamp ${value}`)
      : this.failure(`No entry matches timestamp ${value}.`);
  }

  private failure(error: string): HistoryJumpResult {
    return { error, ok: false };
  }

  private success(entryIndex: number, label: string): HistoryJumpResult {
    if (this.index.entries.length === 0) return this.failure("No transcript history is available.");
    return { entryIndex, label, ok: true };
  }
}
