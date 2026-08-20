import { join } from "node:path";

import { isMissingFileError, readPrivateFile, writePrivateFile } from "./private-file.ts";

const MAX_CONFIG_BYTES = 64 * 1024;
const ACCOUNT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type BillingPolicy = "subscription-only" | "allow-credits";

export type CodexAccount = {
  id: string;
  billing: BillingPolicy;
};

export type CodexSwitcherConfig = {
  accounts: readonly CodexAccount[];
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
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${field} has an unknown field.`);
  }
}

function positiveNumber(value: unknown, fallback: number, field: string, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${field} must be a number greater than zero and at most ${String(max)}.`);
  }
  return value;
}

function parseAccount(raw: unknown, index: number): CodexAccount {
  const field = `accounts[${String(index)}]`;
  const value = object(raw, field);
  exactKeys(value, ["id", "billing"], field);
  const id = value["id"];
  if (typeof id !== "string" || id.length > 48 || !ACCOUNT_ID.test(id)) {
    throw new Error("Each account ID must use lowercase letters, digits, and single hyphens.");
  }
  const billing = value["billing"];
  if (billing !== "subscription-only" && billing !== "allow-credits") {
    throw new Error(`${field}.billing must be subscription-only or allow-credits.`);
  }
  return { id, billing };
}

function parseAccounts(raw: unknown): CodexAccount[] {
  if (!Array.isArray(raw) || raw.length > 16) {
    throw new Error("accounts must contain at most 16 accounts.");
  }
  const accounts = raw.map(parseAccount);
  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) {
    throw new Error("accounts must not contain duplicate account IDs.");
  }
  return accounts;
}

export function parseCodexSwitcherConfig(raw: unknown): CodexSwitcherConfig {
  const value = object(raw, "configuration");
  exactKeys(value, ["accounts", "usage"], "configuration");
  const usage = value["usage"] === undefined ? {} : object(value["usage"], "usage");
  exactKeys(usage, ["refreshMinutes", "timeoutSeconds"], "usage");
  return {
    accounts: parseAccounts(value["accounts"]),
    refreshMs: positiveNumber(usage["refreshMinutes"], 5, "usage.refreshMinutes", 60) * 60_000,
    timeoutMs: positiveNumber(usage["timeoutSeconds"], 10, "usage.timeoutSeconds", 30) * 1_000,
  };
}

function serializableConfig(config: CodexSwitcherConfig): JsonObject {
  return {
    accounts: config.accounts.map(({ id, billing }) => ({ id, billing })),
    usage: {
      refreshMinutes: config.refreshMs / 60_000,
      timeoutSeconds: config.timeoutMs / 1_000,
    },
  };
}

export function writeCodexSwitcherConfig(path: string, config: CodexSwitcherConfig): void {
  writePrivateFile(
    path,
    `${JSON.stringify(serializableConfig(config), undefined, 2)}\n`,
    MAX_CONFIG_BYTES,
  );
}

export function loadCodexSwitcherConfig(path: string): ConfigLoadResult {
  try {
    return {
      status: "ready",
      config: parseCodexSwitcherConfig(
        JSON.parse(readPrivateFile(path, MAX_CONFIG_BYTES)) as unknown,
      ),
    };
  } catch (error) {
    if (isMissingFileError(error)) return { status: "missing" };
    const message =
      error instanceof SyntaxError
        ? "Configuration contains invalid JSON."
        : String(error instanceof Error ? error.message : error);
    return { status: "invalid", message };
  }
}
