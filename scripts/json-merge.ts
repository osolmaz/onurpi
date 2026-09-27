/**
 * Three-way merge for the documents that travel between the live Pi state and this repository.
 *
 * A plain two-way comparison cannot tell which side changed a key, so a key that differs would have
 * to be resolved by a fixed rule that silently discards one side. The merge therefore takes the
 * state both sides last agreed on: a one-sided change is taken from the side that changed it, and a
 * key that both sides changed differently is reported as a conflict instead of being guessed.
 */

import { isRecord } from "./model-overrides.ts";

/** Marks an absent key, so a deleted value stays distinct from a JSON `null`. */
const MISSING = Symbol("missing");

/** The merged document and the dotted paths of the keys that both sides changed differently. */
export type MergeResult = { value: unknown; conflicts: string[] };

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Structural equality that ignores object key order. Arrays stay ordered. */
export function isEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (isList(left) && isList(right)) return isEqualList(left, right);
  if (isRecord(left) && isRecord(right)) return isEqualRecord(left, right);
  return false;
}

function isEqualList(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!isEqual(left[index], right[index])) return false;
  }
  return true;
}

function isEqualRecord(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && isEqual(left[key], right[key]));
}

/** Read a key, distinguishing an absent key from a present `null`. */
function valueAt(record: Record<string, unknown>, key: string): unknown {
  return key in record ? record[key] : MISSING;
}

/** Keys of both sides, ordered so the live document keeps its own key order. */
function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return Object.keys(left).concat(Object.keys(right).filter((key) => !(key in left)));
}

/**
 * Top-level keys whose values differ. This is the report shown when a divergence cannot be
 * attributed to one side, for example when no base is recorded yet.
 */
export function differingKeys(left: unknown, right: unknown): string[] {
  const leftRecord = isRecord(left) ? left : {};
  const rightRecord = isRecord(right) ? right : {};
  return unionKeys(leftRecord, rightRecord)
    .filter((key) => !isEqual(valueAt(leftRecord, key), valueAt(rightRecord, key)))
    .sort();
}

/** What to do with a key that both sides changed differently. */
export type ConflictPolicy = "fail" | "live";

/** Merge options. `onConflict` defaults to `"fail"`, which reports the conflict instead. */
export type MergeOptions = { onConflict?: ConflictPolicy };

/**
 * Merge `live` and `tracked` against `base`. A caller that reports conflicts must not write the
 * result.
 */
export function mergeThreeWay(
  base: unknown,
  live: unknown,
  tracked: unknown,
  options: MergeOptions = {},
): MergeResult {
  const conflicts: string[] = [];
  const value = mergeNode(base, live, tracked, "$", conflicts, options.onConflict ?? "fail");
  return { value: value === MISSING ? undefined : value, conflicts };
}

function mergeNode(
  base: unknown,
  live: unknown,
  tracked: unknown,
  path: string,
  conflicts: string[],
  onConflict: ConflictPolicy,
): unknown {
  if (isEqual(live, tracked)) return live;
  if (isEqual(base, live)) return tracked;
  if (isEqual(base, tracked)) return live;
  if (isRecord(live) && isRecord(tracked)) {
    return mergeRecords(base, live, tracked, path, conflicts, onConflict);
  }
  if (onConflict === "live") return live;
  conflicts.push(path);
  return MISSING;
}

function mergeRecords(
  base: unknown,
  live: Record<string, unknown>,
  tracked: Record<string, unknown>,
  path: string,
  conflicts: string[],
  onConflict: ConflictPolicy,
): Record<string, unknown> {
  // A key added on both sides merges field by field, so treat a missing or replaced base as empty.
  const baseRecord = isRecord(base) ? base : {};
  const merged: Record<string, unknown> = {};
  for (const key of unionKeys(live, tracked)) {
    const value = mergeNode(
      valueAt(baseRecord, key),
      valueAt(live, key),
      valueAt(tracked, key),
      `${path}.${key}`,
      conflicts,
      onConflict,
    );
    if (value !== MISSING) merged[key] = value;
  }
  return merged;
}
