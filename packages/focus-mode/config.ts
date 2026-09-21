/**
 * JSON configuration for focus mode.
 *
 * The file lives next to Pi's other user state: `~/.pi/agent/focus-mode.json`. A missing file means
 * defaults. An unreadable or invalid file also means defaults, with one clear message, because a
 * broken config must not stop a session.
 *
 * This file is persistent user data owned by this package. Removing it plus the sibling
 * `focus-mode/` lease directory fully removes the feature's state.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "focus-mode.json";

/** Test hook: a full path that replaces the user state path when it is set and non-empty. */
export const CONFIG_PATH_ENV = "FOCUS_MODE_CONFIG_PATH";

export const MAX_AGENTS_MIN = 1;
export const MAX_AGENTS_MAX = 16;
export const HEARTBEAT_MS_MIN = 1000;
export const HEARTBEAT_MS_MAX = 60000;
export const STOP_POLL_MS_MIN = 100;
export const STOP_POLL_MS_MAX = 60000;

export type VictimPolicy = "newest" | "oldest";

export type FocusModeConfig = {
  /** Off means every prompt passes and no lease is claimed. */
  enabled: boolean;
  /** How many sessions may work at the same time. */
  maxAgents: number;
  /** How often a holder refreshes its lease. */
  heartbeatMs: number;
  /** How long a lease may go without a heartbeat before the sweep removes it. */
  staleMs: number;
  /** How often a holder looks for a stop request in its own lease. */
  stopPollMs: number;
  /** Which holder yields when the working count is above the cap. */
  victimPolicy: VictimPolicy;
  /** Whether the user sees notifications about refusals and stops. */
  notify: boolean;
};

export type ConfigLoad = {
  path: string;
  config: FocusModeConfig;
  errors: readonly string[];
};

export const DEFAULT_CONFIG: FocusModeConfig = {
  enabled: true,
  maxAgents: 2,
  heartbeatMs: 5000,
  staleMs: 20000,
  stopPollMs: 500,
  victimPolicy: "newest",
  notify: true,
};

const KNOWN_KEYS = [
  "enabled",
  "maxAgents",
  "heartbeatMs",
  "staleMs",
  "stopPollMs",
  "victimPolicy",
  "notify",
] as const;

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

export function resolveConfigPath(agentDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CONFIG_PATH_ENV];
  return override !== undefined && override.length > 0 ? override : configPath(agentDir);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean,
  errors: string[],
): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    errors.push(`${key} must be true or false`);
    return fallback;
  }
  return value;
}

function readWholeNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  errors: string[],
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push(`${key} must be a positive whole number`);
    return fallback;
  }
  if (value < min || value > max) {
    errors.push(`${key} must be between ${String(min)} and ${String(max)}`);
    return clamp(value, min, max);
  }
  return value;
}

function readPolicy(
  source: Record<string, unknown>,
  fallback: VictimPolicy,
  errors: string[],
): VictimPolicy {
  const value = source["victimPolicy"];
  if (value === undefined) return fallback;
  if (value !== "newest" && value !== "oldest") {
    errors.push("victimPolicy must be newest or oldest");
    return fallback;
  }
  return value;
}

function reportUnknownKeys(source: Record<string, unknown>): string[] {
  const known = new Set<string>(KNOWN_KEYS);
  const errors: string[] = [];
  for (const key of Object.keys(source)) {
    if (!known.has(key)) errors.push(`unknown key: ${key}`);
  }
  return errors;
}

/** The heartbeat must stay well below the staleness window, or live sessions look dead. */
function normalize(config: FocusModeConfig, errors: string[]): FocusModeConfig {
  const minimumStaleMs = config.heartbeatMs * 2;
  if (config.staleMs < minimumStaleMs) {
    errors.push(`staleMs must be at least twice heartbeatMs (${String(minimumStaleMs)})`);
    return { ...config, staleMs: minimumStaleMs };
  }
  return config;
}

function buildConfig(source: Record<string, unknown>, errors: string[]): FocusModeConfig {
  return {
    enabled: readBoolean(source, "enabled", DEFAULT_CONFIG.enabled, errors),
    maxAgents: readWholeNumber(
      source,
      "maxAgents",
      DEFAULT_CONFIG.maxAgents,
      MAX_AGENTS_MIN,
      MAX_AGENTS_MAX,
      errors,
    ),
    heartbeatMs: readWholeNumber(
      source,
      "heartbeatMs",
      DEFAULT_CONFIG.heartbeatMs,
      HEARTBEAT_MS_MIN,
      HEARTBEAT_MS_MAX,
      errors,
    ),
    staleMs: readWholeNumber(
      source,
      "staleMs",
      DEFAULT_CONFIG.staleMs,
      HEARTBEAT_MS_MIN,
      HEARTBEAT_MS_MAX * 10,
      errors,
    ),
    stopPollMs: readWholeNumber(
      source,
      "stopPollMs",
      DEFAULT_CONFIG.stopPollMs,
      STOP_POLL_MS_MIN,
      STOP_POLL_MS_MAX,
      errors,
    ),
    victimPolicy: readPolicy(source, DEFAULT_CONFIG.victimPolicy, errors),
    notify: readBoolean(source, "notify", DEFAULT_CONFIG.notify, errors),
  };
}

export function parseConfig(value: unknown): { config: FocusModeConfig; errors: string[] } {
  if (!isRecord(value)) {
    return { config: DEFAULT_CONFIG, errors: ["expected a JSON object"] };
  }
  const errors = reportUnknownKeys(value);
  const config = buildConfig(value, errors);
  return { config: normalize(config, errors), errors };
}

export function loadConfig(path: string): ConfigLoad {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { path, config: DEFAULT_CONFIG, errors: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { path, config: DEFAULT_CONFIG, errors: [`invalid JSON: ${reason}`] };
  }
  const { config, errors } = parseConfig(value);
  return { path, config, errors };
}

/**
 * Write a new cap and keep every other key, including keys this version does not know about.
 */
export function writeMaxAgents(path: string, maxAgents: number): ConfigLoad {
  const clamped = clamp(Math.trunc(maxAgents), MAX_AGENTS_MIN, MAX_AGENTS_MAX);
  let source: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRecord(parsed)) source = parsed;
  } catch {
    source = {};
  }
  source["maxAgents"] = clamped;
  writeFileSync(path, `${JSON.stringify(source, null, 2)}\n`);
  return loadConfig(path);
}
