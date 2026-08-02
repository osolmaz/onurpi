import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { validateModel, validateThinking } from "./args.js";
import type { ThinkingLevel, UserConfig } from "./types.js";

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(root, "pi-reviewer", "config.json");
}

export async function loadConfig(file = defaultConfigPath()): Promise<UserConfig> {
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return { version: 1, auth: "pi" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`failed to parse ${file}: ${errorMessage(error)}`, { cause: error });
  }
  return validateConfig(value, file);
}

export function validateConfig(value: unknown, source = "config"): UserConfig {
  if (!isRecord(value)) throw new Error(`${source}: config must be a JSON object`);
  const allowed = new Set(["version", "auth", "model", "thinking"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${source}: unknown field ${unknown.join(", ")}`);
  if (value["version"] !== 1) throw new Error(`${source}: version must be 1`);
  if (value["auth"] !== "pi") throw new Error(`${source}: auth must be pi`);
  const model = optionalString(value["model"], `${source}: model`);
  const thinking = optionalString(value["thinking"], `${source}: thinking`);
  return {
    version: 1,
    auth: "pi",
    ...(model === undefined ? {} : { model: validateModel(model) }),
    ...(thinking === undefined ? {} : { thinking: validateThinking(thinking) }),
  };
}

export async function setConfigModel(
  model: string,
  file = defaultConfigPath(),
): Promise<UserConfig> {
  const current = await loadConfig(file);
  const next = { ...current, model: validateModel(model) };
  await writeConfig(next, file);
  return next;
}

export async function setConfigThinking(
  thinking: ThinkingLevel,
  file = defaultConfigPath(),
): Promise<UserConfig> {
  const current = await loadConfig(file);
  const next = { ...current, thinking: validateThinking(thinking) };
  await writeConfig(next, file);
  return next;
}

export async function resetConfig(file = defaultConfigPath()): Promise<void> {
  await rm(file, { force: true });
}

export async function writeConfig(config: UserConfig, file = defaultConfigPath()): Promise<void> {
  const validated = validateConfig(config);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.config-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
