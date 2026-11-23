/**
 * Reader for the owner's optional `.command-guard.json` file in the Pi agent directory.
 *
 * The file turns Command Guard off on a whole machine: `{ "enabled": false }` makes the extension
 * load no checks in any session there. `{ "enabled": true }` and a missing file both mean on. The
 * package reads the file once when Pi loads it and never writes it.
 *
 * A file that cannot be read, is not valid JSON, or does not have exactly the `enabled` boolean
 * keeps the guard on and reports the reason: a broken setting must not weaken the guard.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = ".command-guard.json";

export type GuardConfig =
  | { readonly mode: "on" }
  | { readonly mode: "off"; readonly path: string }
  | { readonly mode: "on-after-error"; readonly path: string; readonly error: string };

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turns the parsed file into a config, or into the reason why it keeps the guard on. */
export function parseGuardConfig(value: unknown, path: string): GuardConfig {
  if (!isRecord(value)) {
    return { mode: "on-after-error", path, error: "the file must hold a JSON object" };
  }
  const unknownKeys = Object.keys(value).filter((key) => key !== "enabled");
  if (unknownKeys.length > 0) {
    return {
      mode: "on-after-error",
      path,
      error: `unknown key "${unknownKeys[0] ?? ""}"; the only key is "enabled"`,
    };
  }
  const enabled = value["enabled"];
  if (typeof enabled !== "boolean") {
    return { mode: "on-after-error", path, error: '"enabled" must be true or false' };
  }
  return enabled ? { mode: "on" } : { mode: "off", path };
}

export function readGuardConfig(agentDir: string): GuardConfig {
  const path = configPath(agentDir);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mode: "on" };
    }
    return { mode: "on-after-error", path, error: `cannot read it: ${(error as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { mode: "on-after-error", path, error: `not valid JSON: ${(error as Error).message}` };
  }
  return parseGuardConfig(parsed, path);
}

/** One status line for the config file, or nothing when no file is present. */
export function guardConfigStatus(config: GuardConfig): string | undefined {
  switch (config.mode) {
    case "on":
      return undefined;
    case "off":
      return `${config.path} sets "enabled": false, so the extension loads no checks on this machine.`;
    case "on-after-error":
      return `${config.path} keeps the guard on: ${config.error}.`;
  }
}
