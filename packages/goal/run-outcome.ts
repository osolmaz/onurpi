import { createHash } from "node:crypto";

import {
  accountGoalUsage,
  AUTOMATIC_RUN_LIMIT,
  FINGERPRINT_HISTORY_LIMIT,
  pauseGoal,
  type GoalPause,
  type GoalState,
} from "./goal-state.ts";

const CYCLE_REPETITIONS = 3;
const MAX_CYCLE_LENGTH = 4;
const MAX_CANONICAL_DEPTH = 8;
const MAX_CANONICAL_KEYS = 100;
const MAX_STRING_LENGTH = 32_768;
const HALF_STRING_LENGTH = MAX_STRING_LENGTH / 2;
const OMITTED_MESSAGE_KEYS = new Set([
  "api",
  "model",
  "provider",
  "responseId",
  "timestamp",
  "toolCallId",
  "usage",
]);

export type RunObservation = {
  aborted: boolean;
  elapsedSeconds: number;
  fingerprint: string;
  terminalError: boolean;
  tokenDelta: number;
};

export type RunDisposition = {
  pause: GoalPause | null;
  state: GoalState;
};

type CanonicalValue = boolean | null | number | string | CanonicalValue[] | CanonicalObject;
type CanonicalObject = { readonly [key: string]: CanonicalValue };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, HALF_STRING_LENGTH)}<${String(value.length)} chars>${value.slice(-HALF_STRING_LENGTH)}`;
}

function canonicalNumber(value: number): number | string {
  return Number.isFinite(value) ? value : String(value);
}

function omitCanonicalKey(
  value: Readonly<Record<string, unknown>>,
  key: string,
  depth: number,
): boolean {
  if (depth === 1 && OMITTED_MESSAGE_KEYS.has(key)) return true;
  return depth === 3 && value["type"] === "toolCall" && key === "id";
}

function canonicalRecord(value: Readonly<Record<string, unknown>>, depth: number): CanonicalObject {
  const result: Record<string, CanonicalValue> = {};
  const keys = Object.keys(value)
    .filter((key) => !omitCanonicalKey(value, key, depth))
    .sort()
    .slice(0, MAX_CANONICAL_KEYS);
  for (const key of keys) result[key] = canonicalValue(value[key], depth + 1);
  return result;
}

type CanonicalPrimitiveResult =
  | { matched: false }
  | { matched: true; value: boolean | null | number | string };

function canonicalPrimitive(value: unknown): CanonicalPrimitiveResult {
  if (value === null || value === undefined) return { matched: true, value: null };
  if (typeof value === "string") return { matched: true, value: boundedString(value) };
  if (typeof value === "number") return { matched: true, value: canonicalNumber(value) };
  if (typeof value === "boolean") return { matched: true, value };
  return { matched: false };
}

function canonicalValue(value: unknown, depth = 0): CanonicalValue {
  if (depth >= MAX_CANONICAL_DEPTH) return "<max-depth>";
  const primitive = canonicalPrimitive(value);
  if (primitive.matched) return primitive.value;
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, depth + 1));
  return isRecord(value) ? canonicalRecord(value, depth) : `<${typeof value}>`;
}

function messageRole(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const role = message["role"];
  return typeof role === "string" ? role : undefined;
}

function observableMessages(messages: readonly unknown[]): unknown[] {
  return messages.filter((message) => {
    const role = messageRole(message);
    return role === "assistant" || role === "toolResult";
  });
}

export function runFingerprint(messages: readonly unknown[]): string {
  const canonical = canonicalValue(observableMessages(messages));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `v1:${digest}`;
}

function assistantStopReason(message: unknown): string | undefined {
  if (!isRecord(message) || messageRole(message) !== "assistant") return undefined;
  const stopReason = message["stopReason"];
  return typeof stopReason === "string" ? stopReason : undefined;
}

export function terminalRunState(messages: readonly unknown[]): {
  aborted: boolean;
  terminalError: boolean;
} {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const stopReason = assistantStopReason(messages[index]);
    if (stopReason === undefined) continue;
    return {
      aborted: stopReason === "aborted",
      terminalError: stopReason === "error",
    };
  }
  return { aborted: false, terminalError: false };
}

export function createRunObservation(
  messages: readonly unknown[],
  tokenDelta: number,
  elapsedSeconds: number,
): RunObservation {
  return {
    ...terminalRunState(messages),
    elapsedSeconds: Math.max(0, Math.round(elapsedSeconds)),
    fingerprint: runFingerprint(messages),
    tokenDelta: Math.max(0, Math.round(tokenDelta)),
  };
}

function repeatedSuffix(history: readonly string[], cycleLength: number): boolean {
  const required = cycleLength * CYCLE_REPETITIONS;
  if (history.length < required) return false;
  const start = history.length - required;
  for (let offset = cycleLength; offset < required; offset += 1) {
    if (history[start + offset] !== history[start + (offset % cycleLength)]) return false;
  }
  return true;
}

export function repeatedCycleLength(history: readonly string[]): number | undefined {
  const maxLength = Math.min(MAX_CYCLE_LENGTH, Math.floor(history.length / CYCLE_REPETITIONS));
  for (let cycleLength = 1; cycleLength <= maxLength; cycleLength += 1) {
    if (repeatedSuffix(history, cycleLength)) return cycleLength;
  }
  return undefined;
}

function updatedSafety(state: GoalState, fingerprint: string): GoalState {
  const recentRunFingerprints = [...state.safety.recentRunFingerprints, fingerprint].slice(
    -FINGERPRINT_HISTORY_LIMIT,
  );
  return {
    ...state,
    safety: {
      automaticRunCount: state.safety.automaticRunCount + 1,
      checkpointRunCount: state.safety.checkpointRunCount + 1,
      pause: null,
      recentRunFingerprints,
    },
  };
}

function safetyPause(state: GoalState, observation: RunObservation): GoalPause | null {
  if (observation.aborted) return { reason: "interrupted" };
  if (observation.terminalError) return { reason: "terminal_error" };
  const cycleLength = repeatedCycleLength(state.safety.recentRunFingerprints);
  if (cycleLength !== undefined) {
    return { cycleLength, reason: "repeated_cycle", repetitions: CYCLE_REPETITIONS };
  }
  if (state.safety.checkpointRunCount >= AUTOMATIC_RUN_LIMIT) {
    return { reason: "checkpoint", runLimit: AUTOMATIC_RUN_LIMIT };
  }
  return null;
}

export function recordSettledRun(
  state: GoalState,
  observation: RunObservation,
  now = Date.now(),
): RunDisposition {
  const accounted = accountGoalUsage(
    state,
    observation.tokenDelta,
    observation.elapsedSeconds,
    now,
  );
  if (accounted.status !== "active") return { pause: null, state: accounted };

  const recorded = updatedSafety(accounted, observation.fingerprint);
  const pause = safetyPause(recorded, observation);
  return {
    pause,
    state: pause ? pauseGoal(recorded, pause, now) : recorded,
  };
}
