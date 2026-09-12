/**
 * JSON configuration for the image budget.
 *
 * The file lives next to Pi's other user state, for example `~/.pi/agent/image-budget.json`. A
 * missing file means defaults. An unreadable or invalid file also means defaults, with a clear
 * message, because a broken config must not stop a session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONFIG, type ImageBudgetConfig } from "./image-budget.ts";

export const CONFIG_FILE_NAME = "image-budget.json";

const KNOWN_KEYS = [
  "enabled",
  "maxImageBytes",
  "maxImageWidth",
  "maxImageHeight",
  "maxImagesPerResult",
  "imageBudgetBytes",
  "redactToBytes",
  "notify",
] as const;

export type ConfigLoad = {
  path: string;
  config: ImageBudgetConfig;
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

function readNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  errors: string[],
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push(`${key} must be a positive whole number`);
    return fallback;
  }
  return value;
}

function buildConfig(source: Record<string, unknown>, errors: string[]): ImageBudgetConfig {
  return {
    enabled: readBoolean(source, "enabled", DEFAULT_CONFIG.enabled, errors),
    maxImageBytes: readNumber(source, "maxImageBytes", DEFAULT_CONFIG.maxImageBytes, errors),
    maxImageWidth: readNumber(source, "maxImageWidth", DEFAULT_CONFIG.maxImageWidth, errors),
    maxImageHeight: readNumber(source, "maxImageHeight", DEFAULT_CONFIG.maxImageHeight, errors),
    maxImagesPerResult: readNumber(
      source,
      "maxImagesPerResult",
      DEFAULT_CONFIG.maxImagesPerResult,
      errors,
    ),
    imageBudgetBytes: readNumber(
      source,
      "imageBudgetBytes",
      DEFAULT_CONFIG.imageBudgetBytes,
      errors,
    ),
    redactToBytes: readNumber(source, "redactToBytes", DEFAULT_CONFIG.redactToBytes, errors),
    notify: readBoolean(source, "notify", DEFAULT_CONFIG.notify, errors),
  };
}

function reportUnknownKeys(source: Record<string, unknown>, errors: string[]): void {
  const known = new Set<string>(KNOWN_KEYS);
  for (const key of Object.keys(source)) {
    if (!known.has(key)) errors.push(`unknown key: ${key}`);
  }
}

function normalize(config: ImageBudgetConfig, errors: string[]): ImageBudgetConfig {
  if (config.redactToBytes > config.imageBudgetBytes) {
    errors.push("redactToBytes must not exceed imageBudgetBytes");
    return { ...config, redactToBytes: config.imageBudgetBytes };
  }
  return config;
}

export function parseConfig(value: unknown): { config: ImageBudgetConfig; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    errors.push("expected a JSON object");
    return { config: DEFAULT_CONFIG, errors };
  }
  reportUnknownKeys(value, errors);
  return { config: normalize(buildConfig(value, errors), errors), errors };
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
