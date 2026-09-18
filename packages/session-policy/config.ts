/**
 * JSON configuration for the session policy.
 *
 * The file lives next to Pi's other user state, for example `~/.pi/agent/session-policy.json`. A
 * missing file means defaults. An unreadable or invalid file also means defaults, with a clear
 * message, because a broken config must not stop a session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SessionPolicyConfig = {
  /** Master switch. When false, the extension is inert. */
  enabled: boolean;
  /** Base64 budget for one image returned by a tool. Larger images are re-encoded before caching. */
  maxImageBytes: number;
  /** Maximum width for a re-encoded tool image. */
  maxImageWidth: number;
  /** Maximum height for a re-encoded tool image. */
  maxImageHeight: number;
  /** Byte limit for the in-memory image cache. */
  cacheMaxBytes: number;
  /** Send a UI notification when a live marker has no cached picture. */
  notify: boolean;
};

export const DEFAULT_CONFIG: SessionPolicyConfig = {
  enabled: true,
  maxImageBytes: 400 * 1024,
  maxImageWidth: 1600,
  maxImageHeight: 1600,
  cacheMaxBytes: 64 * 1024 * 1024,
  notify: true,
};

export const CONFIG_FILE_NAME = "session-policy.json";

const KNOWN_KEYS = [
  "enabled",
  "maxImageBytes",
  "maxImageWidth",
  "maxImageHeight",
  "cacheMaxBytes",
  "notify",
] as const;

export type ConfigLoad = {
  path: string;
  config: SessionPolicyConfig;
  errors: readonly string[];
};

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Read one optional key. A missing key keeps its default, and a wrong type or value is reported and
 * replaced by the default, so one bad field never stops a session.
 */
function readField<T>(
  source: Record<string, unknown>,
  key: string,
  fallback: T,
  accepts: (value: unknown) => value is T,
  complaint: string,
  errors: string[],
): T {
  const value = source[key];
  if (value === undefined) return fallback;
  if (!accepts(value)) {
    errors.push(`${key} ${complaint}`);
    return fallback;
  }
  return value;
}

function buildConfig(source: Record<string, unknown>, errors: string[]): SessionPolicyConfig {
  const boolean = "must be true or false";
  const count = "must be a positive whole number";
  return {
    enabled: readField(source, "enabled", DEFAULT_CONFIG.enabled, isBoolean, boolean, errors),
    maxImageBytes: readField(
      source,
      "maxImageBytes",
      DEFAULT_CONFIG.maxImageBytes,
      isPositiveInteger,
      count,
      errors,
    ),
    maxImageWidth: readField(
      source,
      "maxImageWidth",
      DEFAULT_CONFIG.maxImageWidth,
      isPositiveInteger,
      count,
      errors,
    ),
    maxImageHeight: readField(
      source,
      "maxImageHeight",
      DEFAULT_CONFIG.maxImageHeight,
      isPositiveInteger,
      count,
      errors,
    ),
    cacheMaxBytes: readField(
      source,
      "cacheMaxBytes",
      DEFAULT_CONFIG.cacheMaxBytes,
      isPositiveInteger,
      count,
      errors,
    ),
    notify: readField(source, "notify", DEFAULT_CONFIG.notify, isBoolean, boolean, errors),
  };
}

function reportUnknownKeys(source: Record<string, unknown>, errors: string[]): void {
  const known = new Set<string>(KNOWN_KEYS);
  for (const key of Object.keys(source)) {
    if (!known.has(key)) errors.push(`unknown key: ${key}`);
  }
}

export function parseConfig(value: unknown): {
  config: SessionPolicyConfig;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) {
    errors.push("expected a JSON object");
    return { config: DEFAULT_CONFIG, errors };
  }
  reportUnknownKeys(value, errors);
  return { config: buildConfig(value, errors), errors };
}

export function readConfig(path: string): ConfigLoad {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { path, config: DEFAULT_CONFIG, errors: [] };
    }
    return { path, config: DEFAULT_CONFIG, errors: [`${path} could not be read`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { path, config: DEFAULT_CONFIG, errors: [`${path} is not valid JSON`] };
  }
  const { config, errors } = parseConfig(parsed);
  return { path, config, errors };
}
