import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CONFIG_BYTES = 64 * 1024;
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type BillingPolicy = "subscription-only" | "allow-credits";

export type CodexProfile = {
  id: string;
  label: string;
  billing: BillingPolicy;
  providerId: string;
};

export type CodexSwitcherConfig = {
  profiles: readonly CodexProfile[];
  fallbackChain: readonly string[];
  refreshMs: number;
  timeoutMs: number;
};

export type ConfigLoadResult =
  | { status: "ready"; config: CodexSwitcherConfig }
  | { status: "missing" }
  | { status: "invalid"; message: string };

type JsonObject = Record<string, unknown>;

export function codexSwitcherConfigPath(agentDir: string): string {
  return join(agentDir, "codex-switcher.json");
}

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: readonly string[], field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${field} has an unknown field.`);
}

function positiveNumber(value: unknown, fallback: number, field: string, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${field} must be a number greater than zero and at most ${String(max)}.`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function validLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 80 &&
    !hasControlCharacter(value)
  );
}

function parseProfile(id: string, raw: unknown): CodexProfile {
  if (!PROFILE_ID.test(id) || id.length > 48) {
    throw new Error("Each profile ID must use lowercase letters, digits, and single hyphens.");
  }
  const value = object(raw, `profiles.${id}`);
  exactKeys(value, ["label", "billing"], `profiles.${id}`);
  const label = value["label"];
  const billing = value["billing"];
  if (!validLabel(label)) {
    throw new Error(`profiles.${id}.label must be a nonempty string of at most 80 characters.`);
  }
  if (billing !== "subscription-only" && billing !== "allow-credits") {
    throw new Error(`profiles.${id}.billing must be "subscription-only" or "allow-credits".`);
  }
  return { id, label: label.trim(), billing, providerId: providerIdForProfile(id) };
}

function parseProfiles(raw: unknown): CodexProfile[] {
  const value = object(raw, "profiles");
  const profiles = Object.entries(value).map(([id, profile]) => parseProfile(id, profile));
  if (profiles.length === 0) throw new Error("profiles must contain at least one profile.");
  if (profiles.length > 16) throw new Error("profiles must contain at most 16 profiles.");
  return profiles;
}

function parseChain(raw: unknown, profiles: readonly CodexProfile[]): string[] {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error("fallbackChain must be an array of profile IDs.");
  }
  const chain = raw as string[];
  if (new Set(chain).size !== chain.length) {
    throw new Error("fallbackChain must not contain duplicate profile IDs.");
  }
  const configured = new Set(profiles.map((profile) => profile.id));
  if (chain.length !== configured.size || chain.some((id) => !configured.has(id))) {
    throw new Error("fallbackChain must contain every configured profile exactly once.");
  }
  return [...chain];
}

export function parseCodexSwitcherConfig(raw: unknown): CodexSwitcherConfig {
  const value = object(raw, "configuration");
  exactKeys(value, ["profiles", "fallbackChain", "usage"], "configuration");
  const profiles = parseProfiles(value["profiles"]);
  const fallbackChain = parseChain(value["fallbackChain"], profiles);
  const usage = value["usage"] === undefined ? {} : object(value["usage"], "usage");
  exactKeys(usage, ["refreshMinutes", "timeoutSeconds"], "usage");
  const refreshMinutes = positiveNumber(usage["refreshMinutes"], 5, "usage.refreshMinutes", 60);
  const timeoutSeconds = positiveNumber(usage["timeoutSeconds"], 10, "usage.timeoutSeconds", 30);
  return {
    profiles,
    fallbackChain,
    refreshMs: refreshMinutes * 60_000,
    timeoutMs: timeoutSeconds * 1_000,
  };
}

export function providerIdForProfile(profileId: string): string {
  return `openai-codex-${profileId}`;
}

function readBoundedConfig(path: string): string {
  const descriptor = openSync(path, "r");
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
      throw new Error(
        `Configuration must be a regular file no larger than ${String(MAX_CONFIG_BYTES)} bytes.`,
      );
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function loadCodexSwitcherConfig(path: string): ConfigLoadResult {
  try {
    return {
      status: "ready",
      config: parseCodexSwitcherConfig(JSON.parse(readBoundedConfig(path)) as unknown),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    const message =
      error instanceof SyntaxError
        ? "Configuration contains invalid JSON."
        : String(error instanceof Error ? error.message : error);
    return { status: "invalid", message };
  }
}
