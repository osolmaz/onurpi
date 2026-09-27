/**
 * Settings handling for the tracked `settings.json` copy.
 *
 * `~/.pi/agent/settings.json` mixes reviewed preferences, machine-local Pi state, and the live
 * package list, which may point into a development worktree. Only the reviewed preferences travel
 * between the live file and this repository.
 */

import { isEqual } from "./json-merge.ts";

/**
 * Pi state that describes one machine only, so the repository neither records nor applies it.
 *
 * `lastChangelogVersion` records which changelog this machine has already shown. A value copied
 * from another machine would suppress the notice here. Machine-specific paths and consent flags,
 * such as `sessionDir`, `shellPath`, or `enableAnalytics`, belong in this list if they are ever set.
 */
export const LOCAL_ONLY_KEYS = ["lastChangelogVersion"] as const;

function isLocalOnly(key: string): boolean {
  return (LOCAL_ONLY_KEYS as readonly string[]).includes(key);
}

/** The repository view of an untracked live file: reviewed keys only, in the original order. */
export function stripLocalOnly(settings: Record<string, unknown>): Record<string, unknown> {
  const reviewed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!isLocalOnly(key)) reviewed[key] = value;
  }
  return reviewed;
}

/**
 * Apply the values the merge changed to the live file.
 *
 * Only keys whose merged value differs from the live view are written. That keeps everything else
 * exactly as the machine holds it, including package entries that point into a worktree, key order,
 * and machine-local keys.
 */
export function applySettingsChanges(
  live: Record<string, unknown>,
  liveView: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (isLocalOnly(key)) {
      result[key] = value;
      continue;
    }
    if (!(key in merged)) continue;
    const reviewed = merged[key];
    result[key] = isEqual(reviewed, liveView[key]) ? value : reviewed;
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in live)) result[key] = value;
  }
  return result;
}

/**
 * Make the live file match the tracked one, keeping machine-local keys. This is the forced
 * repository-wins direction, used when the repository state should replace the local one. Keys the
 * live file already holds keep their position, so the live document is not reordered.
 */
export function adoptTracked(
  tracked: Record<string, unknown>,
  live: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (isLocalOnly(key)) result[key] = value;
    else if (key in tracked) result[key] = tracked[key];
  }
  for (const [key, value] of Object.entries(tracked)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
}
