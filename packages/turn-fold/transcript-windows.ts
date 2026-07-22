import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_TRANSCRIPT_WINDOWS = 3;
export const ALL_TRANSCRIPT_WINDOWS = "all" as const;

export type TranscriptWindowValue = number | typeof ALL_TRANSCRIPT_WINDOWS;
type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

export type WindowArgumentResult =
  | { error: string; ok: false }
  | { ok: true; value: TranscriptWindowValue };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function entryType(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry["type"] === "string" ? entry["type"] : undefined;
}

function isUserEntry(entry: unknown): boolean {
  if (entryType(entry) !== "message" || !isRecord(entry)) return false;
  const message = entry["message"];
  return isRecord(message) && message["role"] === "user";
}

export function isTranscriptWindowValue(value: unknown): value is TranscriptWindowValue {
  return (
    value === ALL_TRANSCRIPT_WINDOWS ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
}

export function compactionWindowCount(entries: readonly BranchEntry[]): number {
  let compactions = 0;
  for (const entry of entries) {
    if (entryType(entry) === "compaction") compactions += 1;
  }
  return compactions + 1;
}

export function selectTranscriptEntries(
  entries: readonly BranchEntry[],
  value: TranscriptWindowValue,
): BranchEntries {
  if (value === ALL_TRANSCRIPT_WINDOWS) return [...entries];

  const compactionIndices: number[] = [];
  entries.forEach((entry, index) => {
    if (entryType(entry) === "compaction") compactionIndices.push(index);
  });
  if (compactionIndices.length < value) return [...entries];

  const boundaryIndex = compactionIndices[compactionIndices.length - value];
  if (boundaryIndex === undefined) return [...entries];
  let startIndex = boundaryIndex;
  for (let index = boundaryIndex - 1; index >= 0; index -= 1) {
    if (isUserEntry(entries[index])) {
      startIndex = index;
      break;
    }
  }
  return entries.slice(startIndex);
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function invalidArgument(): WindowArgumentResult {
  return {
    error: "Use a positive number, +N, -N, all, or reset.",
    ok: false,
  };
}

function resolveRelativeArgument(
  sign: string,
  delta: number,
  current: TranscriptWindowValue,
  totalWindows: number,
): WindowArgumentResult {
  if (sign === "+") {
    if (current === ALL_TRANSCRIPT_WINDOWS) {
      return { ok: true, value: ALL_TRANSCRIPT_WINDOWS };
    }
    const next = current + delta;
    return Number.isSafeInteger(next) ? { ok: true, value: next } : invalidArgument();
  }
  const effectiveCurrent = current === ALL_TRANSCRIPT_WINDOWS ? totalWindows : current;
  return { ok: true, value: Math.max(1, effectiveCurrent - delta) };
}

function fixedWindowValue(value: string): TranscriptWindowValue | undefined {
  if (value === "all") return ALL_TRANSCRIPT_WINDOWS;
  if (value === "reset") return DEFAULT_TRANSCRIPT_WINDOWS;
  return parsePositiveInteger(value);
}

export function resolveWindowArgument(
  argument: string,
  current: TranscriptWindowValue,
  totalWindows: number,
): WindowArgumentResult {
  const value = argument.trim().toLowerCase();
  const fixed = fixedWindowValue(value);
  if (fixed !== undefined) return { ok: true, value: fixed };

  const relativeMatch = /^([+-])([1-9]\d*)$/u.exec(value);
  const delta = parsePositiveInteger(relativeMatch?.[2] ?? "");
  if (!relativeMatch || delta === undefined) return invalidArgument();
  return resolveRelativeArgument(relativeMatch[1] ?? "", delta, current, totalWindows);
}

export function formatTranscriptWindowValue(value: TranscriptWindowValue): string {
  return value === ALL_TRANSCRIPT_WINDOWS ? "all" : String(value);
}
