/**
 * JSON configuration for the context budget.
 *
 * The file lives next to Pi's other user state, for example `~/.pi/agent/context-budget.json`. A
 * missing file means defaults. An unreadable or invalid file also means defaults, with a clear
 * message, because a broken config must not stop a session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONFIG, type ContextBudgetConfig } from "./context-budget.ts";

export const CONFIG_FILE_NAME = "context-budget.json";

const KNOWN_KEYS = [
  "enabled",
  "warnChars",
  "warnTokens",
  "charsPerToken",
  "status",
  "notify",
] as const;

export type ConfigLoad = {
  path: string;
  config: ContextBudgetConfig;
  errors: readonly string[];
};

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readInteger(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  errors: string[],
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  const minimum = allowZero ? 0 : 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    errors.push(`${key} must be a whole number of at least ${String(minimum)}`);
    return fallback;
  }
  return value;
}

function reportUnknownKeys(source: Record<string, unknown>, errors: string[]): void {
  const known = new Set<string>(KNOWN_KEYS);
  for (const key of Object.keys(source)) {
    if (!known.has(key)) errors.push(`unknown key: ${key}`);
  }
}

export function parseConfig(value: unknown): { config: ContextBudgetConfig; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    errors.push("expected a JSON object");
    return { config: DEFAULT_CONFIG, errors };
  }
  reportUnknownKeys(value, errors);
  const config: ContextBudgetConfig = {
    enabled: readBoolean(value, "enabled", DEFAULT_CONFIG.enabled, errors),
    warnChars: readInteger(value, "warnChars", DEFAULT_CONFIG.warnChars, errors),
    warnTokens: readInteger(value, "warnTokens", DEFAULT_CONFIG.warnTokens, errors, {
      allowZero: true,
    }),
    charsPerToken: readInteger(value, "charsPerToken", DEFAULT_CONFIG.charsPerToken, errors),
    status: readBoolean(value, "status", DEFAULT_CONFIG.status, errors),
    notify: readBoolean(value, "notify", DEFAULT_CONFIG.notify, errors),
  };
  return { config, errors };
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
