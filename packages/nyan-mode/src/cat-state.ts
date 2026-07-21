export type CatMood =
  | "neutral"
  | "dancing"
  | "thinking"
  | "focused"
  | "pleased"
  | "unimpressed"
  | "annoyed"
  | "angry";

export type CatState = {
  streaming: boolean;
  startedAtMs: number | undefined;
  activeToolIds: ReadonlySet<string>;
  errorCount: number;
  consecutiveErrors: number;
  lastErrorAtMs: number | undefined;
  lastSuccessAtMs: number | undefined;
};

export type CatEvent =
  | { type: "stream_started"; nowMs: number }
  | { type: "stream_stopped" }
  | { type: "tool_started"; toolCallId: string }
  | { type: "tool_finished"; toolCallId: string; isError: boolean; nowMs: number };

const RECENT_ERROR_MS = 12_000;
const ERROR_MEMORY_MS = 60_000;
const RECENT_SUCCESS_MS = 4_000;
const THINKING_AFTER_MS = 15_000;
const DELIBERATE_AFTER_MS = 45_000;
const UNIMPRESSED_AFTER_MS = 90_000;
const ANNOYED_AFTER_MS = 150_000;
const ANGRY_AFTER_MS = 240_000;

export function createCatState(): CatState {
  return {
    streaming: false,
    startedAtMs: undefined,
    activeToolIds: new Set<string>(),
    errorCount: 0,
    consecutiveErrors: 0,
    lastErrorAtMs: undefined,
    lastSuccessAtMs: undefined,
  };
}

export function reduceCatState(state: CatState, event: CatEvent): CatState {
  if (event.type === "stream_started") {
    return {
      ...state,
      streaming: true,
      startedAtMs: event.nowMs,
      activeToolIds: new Set<string>(),
      consecutiveErrors: 0,
    };
  }
  if (event.type === "stream_stopped") {
    return { ...state, streaming: false, startedAtMs: undefined, activeToolIds: new Set<string>() };
  }
  if (event.type === "tool_started") {
    const activeToolIds = new Set(state.activeToolIds);
    activeToolIds.add(event.toolCallId);
    return { ...state, activeToolIds };
  }
  return finishTool(state, event);
}

export function selectCatMood(state: CatState, nowMs: number): CatMood {
  if (!state.streaming || state.startedAtMs === undefined) return "neutral";

  const elapsedMs = Math.max(0, nowMs - state.startedAtMs);
  const errorAgeMs = age(nowMs, state.lastErrorAtMs);
  const escalation = selectEscalation(state, elapsedMs, errorAgeMs);
  if (escalation) return escalation;
  const activity = selectActivity(state, age(nowMs, state.lastSuccessAtMs));
  return activity ?? selectDurationMood(elapsedMs);
}

function finishTool(
  state: CatState,
  event: Extract<CatEvent, { type: "tool_finished" }>,
): CatState {
  const activeToolIds = new Set(state.activeToolIds);
  activeToolIds.delete(event.toolCallId);
  return event.isError
    ? {
        ...state,
        activeToolIds,
        errorCount: state.errorCount + 1,
        consecutiveErrors: state.consecutiveErrors + 1,
        lastErrorAtMs: event.nowMs,
      }
    : {
        ...state,
        activeToolIds,
        consecutiveErrors: 0,
        lastSuccessAtMs: event.nowMs,
      };
}

function age(nowMs: number, timestampMs: number | undefined): number {
  return timestampMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - timestampMs);
}

function selectEscalation(
  state: CatState,
  elapsedMs: number,
  errorAgeMs: number,
): CatMood | undefined {
  if (isAngry(state, elapsedMs, errorAgeMs)) return "angry";
  if (elapsedMs >= ANNOYED_AFTER_MS || errorAgeMs <= RECENT_ERROR_MS) return "annoyed";
  if (state.errorCount >= 4 && errorAgeMs <= ERROR_MEMORY_MS) return "unimpressed";
  return undefined;
}

function isAngry(state: CatState, elapsedMs: number, errorAgeMs: number): boolean {
  return (
    elapsedMs >= ANGRY_AFTER_MS ||
    state.consecutiveErrors >= 3 ||
    (state.consecutiveErrors >= 2 && errorAgeMs <= ERROR_MEMORY_MS)
  );
}

function selectActivity(state: CatState, successAgeMs: number): CatMood | undefined {
  if (state.activeToolIds.size > 0) return "focused";
  if (successAgeMs <= RECENT_SUCCESS_MS) return "pleased";
  return undefined;
}

function selectDurationMood(elapsedMs: number): CatMood {
  if (elapsedMs >= UNIMPRESSED_AFTER_MS) return "unimpressed";
  if (elapsedMs >= DELIBERATE_AFTER_MS) return deliberateMood(elapsedMs);
  if (elapsedMs >= THINKING_AFTER_MS) return earlyMood(elapsedMs);
  return "dancing";
}

function earlyMood(elapsedMs: number): CatMood {
  const phase = Math.floor((elapsedMs - THINKING_AFTER_MS) / 7_500) % 3;
  if (phase === 0) return "thinking";
  if (phase === 1) return "dancing";
  return "focused";
}

function deliberateMood(elapsedMs: number): CatMood {
  return Math.floor((elapsedMs - DELIBERATE_AFTER_MS) / 8_000) % 2 === 0 ? "thinking" : "focused";
}
