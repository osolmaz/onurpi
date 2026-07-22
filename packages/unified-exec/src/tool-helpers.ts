import { constants as osConstants } from "node:os";

import {
  DEFAULT_MAX_BACKGROUND_POLL_MS,
  DEFAULT_WRITE_STDIN_YIELD_MS,
  MAX_EMPTY_POLL_ENV_VAR,
  MAX_YIELD_TIME_MS,
  MIN_EMPTY_YIELD_TIME_MS,
  MIN_YIELD_TIME_MS,
} from "./constants.ts";
import { encode } from "./response.ts";
import { nowUtcIso } from "./time.ts";
import type { WriteStdinArgs } from "./tool-schema.ts";
import { unescapeChars } from "./unescape.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampYield(value: number | undefined, defaultValue: number): number {
  const selected = typeof value === "number" && value > 0 ? value : defaultValue;
  return clamp(Math.floor(selected), MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS);
}

export function resolveMaxEmptyPollMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MAX_EMPTY_POLL_ENV_VAR]?.trim();
  if (!raw) return DEFAULT_MAX_BACKGROUND_POLL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BACKGROUND_POLL_MS;
  return clamp(Math.floor(parsed), MIN_EMPTY_YIELD_TIME_MS, DEFAULT_MAX_BACKGROUND_POLL_MS);
}

export function resolveEmptyPollYield(value: number | undefined): number {
  const cap = resolveMaxEmptyPollMs();
  if (typeof value === "number" && Math.floor(value) > cap) {
    throw new Error(
      `write_stdin: yield-time_ms ${String(Math.floor(value))} exceeds the empty-poll cap of ${String(cap)} ms. ` +
        "Use repeated polls, or use yield_until only when the human explicitly requested a long attached wait. " +
        `tool_time_utc: ${nowUtcIso()}`,
    );
  }
  const selected = typeof value === "number" && value > 0 ? value : DEFAULT_WRITE_STDIN_YIELD_MS;
  return clamp(Math.floor(selected), MIN_EMPTY_YIELD_TIME_MS, cap);
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

// eslint-disable-next-line complexity -- Keep mutually exclusive text and binary validation together.
export function resolveWriteInput(args: WriteStdinArgs): Uint8Array | undefined {
  const hasChars = typeof args.chars === "string" && args.chars.length > 0;
  const hasBase64 = typeof args.chars_b64 === "string" && args.chars_b64.length > 0;
  if (hasChars && hasBase64) {
    throw new Error("write_stdin: pass either `chars` or `chars_b64`, not both.");
  }
  if (hasBase64 && args.chars_b64) {
    const value = args.chars_b64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw new Error("write_stdin: `chars_b64` is not valid base64.");
    }
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (hasChars && args.chars) return encode(unescapeChars(args.chars));
  return undefined;
}
