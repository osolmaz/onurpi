import { constants as osConstants } from "node:os";

import {
  DEFAULT_WRITE_STDIN_YIELD_MS,
  MAX_EMPTY_POLL_ENV_VAR,
  MAX_YIELD_TIME_MS,
  MIN_EMPTY_YIELD_TIME_MS,
  MIN_YIELD_TIME_MS,
} from "./constants.ts";
import { resolveCommandInput } from "./command-input.ts";
import { nowUtcIso } from "./time.ts";
import type { WriteStdinArgs } from "./tool-schema.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampYield(value: number | undefined, defaultValue: number): number {
  const selected = typeof value === "number" && value > 0 ? value : defaultValue;
  return clamp(Math.floor(selected), MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS);
}

export function resolveMaxEmptyPollMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[MAX_EMPTY_POLL_ENV_VAR]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `${MAX_EMPTY_POLL_ENV_VAR} must be a positive finite duration no greater than Number.MAX_SAFE_INTEGER.`,
    );
  }
  return Math.max(MIN_EMPTY_YIELD_TIME_MS, Math.floor(parsed));
}

function invalidDuration(value: number | undefined): boolean {
  return (
    value !== undefined && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
  );
}

export function resolveEmptyPollYield(
  value: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (invalidDuration(value)) {
    throw new Error(
      "write_stdin: yield_time_ms must be a non-negative finite duration no greater than Number.MAX_SAFE_INTEGER.",
    );
  }
  const duration = Math.max(
    MIN_EMPTY_YIELD_TIME_MS,
    Math.floor(value ?? DEFAULT_WRITE_STDIN_YIELD_MS),
  );
  const cap = resolveMaxEmptyPollMs(env);
  if (cap !== undefined && duration > cap) {
    throw new Error(
      `write_stdin: yield_time_ms ${String(duration)} exceeds the configured empty-poll cap of ${String(cap)} ms ` +
        `(${MAX_EMPTY_POLL_ENV_VAR}). Request a shorter wait. tool_time_utc: ${nowUtcIso()}`,
    );
  }
  return duration;
}

function isSignalName(name: string): name is NodeJS.Signals {
  return Object.hasOwn(osConstants.signals, name);
}

export function normalizeSignal(raw: string | undefined): NodeJS.Signals {
  if (!raw) return "SIGTERM";
  const upper = raw.trim().toUpperCase();
  const name = upper.startsWith("SIG") ? upper : `SIG${upper}`;
  if (!isSignalName(name)) {
    throw new Error(`unknown signal "${raw}" (use SIGTERM, SIGINT, SIGKILL, …)`);
  }
  return name;
}

export function resolveWriteInput(args: WriteStdinArgs): Uint8Array | undefined {
  return resolveCommandInput(args);
}
