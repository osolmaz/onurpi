import { readFile } from "node:fs/promises";

import type { CustomModelManifest, ModelSelection } from "./types.js";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 2_048;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const INPUT_TYPES = new Set(["text", "image"]);

export async function loadCustomModelManifest(
  path: string,
  selection: ModelSelection,
): Promise<CustomModelManifest> {
  const content = await readFile(path);
  if (content.length > MAX_MANIFEST_BYTES) throw new Error("model manifest is too large");
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("model manifest is not valid JSON");
  }
  const manifest = parseManifest(value);
  if (manifest.provider.id !== selection.provider || manifest.model.id !== selection.model) {
    throw new Error("model manifest does not match the selected provider/model");
  }
  return manifest;
}

function parseManifest(value: unknown): CustomModelManifest {
  const source = strictRecord(value, ["version", "provider", "model"], "model manifest");
  if (source["version"] !== 1) throw new Error("model manifest version must be 1");
  return {
    version: 1,
    provider: parseProvider(source["provider"]),
    model: parseModel(source["model"]),
  };
}

function parseProvider(value: unknown): CustomModelManifest["provider"] {
  const source = strictRecord(
    value,
    ["id", "baseUrl", "apiKeyEnv", "compat"],
    "model manifest provider",
  );
  const baseUrl = requiredString(source["baseUrl"], "provider baseUrl");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("provider baseUrl must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("provider baseUrl must use HTTPS");
  const apiKeyEnv = optionalString(source["apiKeyEnv"], "provider apiKeyEnv");
  if (apiKeyEnv !== undefined && !ENVIRONMENT_NAME.test(apiKeyEnv)) {
    throw new Error("provider apiKeyEnv must be an environment variable name");
  }
  const compat = parseCompat(source["compat"]);
  return {
    id: requiredString(source["id"], "provider id"),
    baseUrl,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(compat === undefined ? {} : { compat }),
  };
}

function parseCompat(value: unknown): CustomModelManifest["provider"]["compat"] {
  if (value === undefined) return undefined;
  const source = strictRecord(
    value,
    ["supportsDeveloperRole", "supportsReasoningEffort"],
    "provider compat",
  );
  const supportsDeveloperRole = optionalBoolean(
    source["supportsDeveloperRole"],
    "compat supportsDeveloperRole",
  );
  const supportsReasoningEffort = optionalBoolean(
    source["supportsReasoningEffort"],
    "compat supportsReasoningEffort",
  );
  return {
    ...(supportsDeveloperRole === undefined ? {} : { supportsDeveloperRole }),
    ...(supportsReasoningEffort === undefined ? {} : { supportsReasoningEffort }),
  };
}

function parseModel(value: unknown): CustomModelManifest["model"] {
  const source = strictRecord(
    value,
    ["id", "name", "reasoning", "thinkingFormat", "input", "contextWindow", "maxTokens", "cost"],
    "model manifest model",
  );
  const name = optionalString(source["name"], "model name");
  const reasoning = optionalBoolean(source["reasoning"], "model reasoning");
  const thinkingFormat = parseThinkingFormat(source["thinkingFormat"]);
  const input = parseInput(source["input"]);
  const contextWindow = optionalPositiveInteger(source["contextWindow"], "model contextWindow");
  const maxTokens = optionalPositiveInteger(source["maxTokens"], "model maxTokens");
  const cost = parseCost(source["cost"]);
  return {
    id: requiredString(source["id"], "model id"),
    ...(name === undefined ? {} : { name }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(thinkingFormat === undefined ? {} : { thinkingFormat }),
    ...(input === undefined ? {} : { input }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(cost === undefined ? {} : { cost }),
  };
}

function parseThinkingFormat(value: unknown): CustomModelManifest["model"]["thinkingFormat"] {
  if (value === undefined || value === "deepseek" || value === "qwen-chat-template") return value;
  throw new Error("model thinkingFormat is unsupported");
}

function parseInput(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error("model input must be non-empty");
  const input: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !INPUT_TYPES.has(item)) {
      throw new Error("model input contains an unsupported type");
    }
    input.push(item);
  }
  return input;
}

function parseCost(value: unknown): CustomModelManifest["model"]["cost"] {
  if (value === undefined) return undefined;
  const source = strictRecord(value, ["input", "output", "cacheRead", "cacheWrite"], "model cost");
  return {
    input: nonnegativeNumber(source["input"], "cost input"),
    output: nonnegativeNumber(source["output"], "cost output"),
    cacheRead: nonnegativeNumber(source["cacheRead"], "cost cacheRead"),
    cacheWrite: nonnegativeNumber(source["cacheWrite"], "cost cacheWrite"),
  };
}

function strictRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING_LENGTH) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative number`);
  }
  return value;
}
