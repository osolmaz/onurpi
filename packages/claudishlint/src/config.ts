/**
 * Reader for the optional `.claudishlint.json` file in the Pi agent directory.
 *
 * A missing file means defaults. A file that is not valid JSON, or that does not match the expected
 * shape, raises a clear error. A broken gate setting must not pass silently.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { ReviewOptions } from "./claudishlint/types.ts";

export const CONFIG_FILE_NAME = ".claudishlint.json";

const KNOWN_KEYS = ["strictness", "rules"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

function readStrictness(value: unknown, source: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${source} needs a strictness from 0 to 1`);
  }
  return value;
}

function readRules(value: unknown, source: string): Record<string, 0 | 1> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${source} needs rules as an object of rule ids`);
  }
  const overrides: Record<string, 0 | 1> = {};
  for (const [ruleId, override] of Object.entries(value)) {
    if (override !== 0 && override !== 1) {
      throw new Error(`${source} needs rules["${ruleId}"] to be 0 or 1`);
    }
    overrides[ruleId] = override;
  }
  return overrides;
}

export function parseConfig(value: unknown, source: string): ReviewOptions {
  if (!isRecord(value)) {
    throw new Error(`${source} must hold a JSON object`);
  }
  for (const key of Object.keys(value)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `${source} has the unknown key "${key}"; the allowed keys are ${KNOWN_KEYS.join(" and ")}`,
      );
    }
  }

  const options: ReviewOptions = {};
  const strictness = readStrictness(value["strictness"], source);
  if (strictness !== undefined) {
    options.strictness = strictness;
  }
  const rules = readRules(value["rules"], source);
  if (rules !== undefined) {
    options.rules = rules;
  }
  return options;
}

export function readConfig(): ReviewOptions {
  const path = configPath(getAgentDir());

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  return parseConfig(parsed, path);
}
