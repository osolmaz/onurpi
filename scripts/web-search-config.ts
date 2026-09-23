/**
 * Reviewed Pi web-search settings for the tracked `web-search.json` copy.
 *
 * `~/.pi/agent/web-search.json` is also a credential store: it can hold provider API keys, a proxy
 * URL, and other machine-local values. Only the reviewed, non-secret settings travel between the
 * live file and this repository.
 */

import { isRecord } from "./model-overrides.ts";

/**
 * Settings that are safe to publish and useful on another machine. Keys outside this list stay
 * machine-local, including every provider API key and the proxy URL.
 */
export const TRACKED_KEYS = [
  "workflow",
  "autoOpenBrowser",
  "curatorTimeoutSeconds",
  "summaryModel",
  "summaryGenerationDeadlineMs",
  "maxInlineContentChars",
  "provider",
  "searchProvider",
  "webSearch",
  "tools",
  "commands",
] as const;

/** Defense in depth: never copy a key that looks like a credential, even if it were listed. */
const SECRET_KEY_PATTERN = /(apikey|api_key|token|secret|password|credential|auth|proxy)/i;

function isTrackedKey(key: string): boolean {
  return (TRACKED_KEYS as readonly string[]).includes(key) && !SECRET_KEY_PATTERN.test(key);
}

/** Copy only the reviewed, non-secret settings out of a machine-local web-search.json. */
export function extractWebSearchSettings(live: unknown): Record<string, unknown> {
  if (!isRecord(live)) return {};

  const collected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (!isTrackedKey(key)) continue;
    if (value === undefined) continue;
    collected[key] = value;
  }
  return collected;
}

/** Merge tracked settings onto a live web-search.json without touching credentials or other keys. */
export function applyWebSearchSettings(
  live: unknown,
  tracked: unknown,
  sourceLabel = "web-search.json",
): Record<string, unknown> {
  if (live !== undefined && !isRecord(live)) throw new Error(`No object in ${sourceLabel}`);
  if (!isRecord(tracked)) throw new Error(`Invalid web-search settings in ${sourceLabel}`);

  const merged: Record<string, unknown> = isRecord(live) ? { ...live } : {};
  for (const [key, value] of Object.entries(tracked)) {
    if (!isTrackedKey(key)) continue;
    merged[key] = value;
  }
  return merged;
}
