export const AUTOMATIC_RUN_LIMIT = 20;
export const FINGERPRINT_HISTORY_LIMIT = 12;

export type GoalStatus = "active" | "paused" | "budget_limited" | "complete";

export type GoalPause =
  | { reason: "user" }
  | { reason: "reload" }
  | { reason: "interrupted" }
  | { reason: "terminal_error" }
  | { action: "nudge" | "trip"; reason: "loop_guard" }
  | { cycleLength: number; reason: "repeated_cycle"; repetitions: number }
  | { reason: "checkpoint"; runLimit: number };

export type GoalSafetyState = {
  automaticRunCount: number;
  checkpointRunCount: number;
  pause: GoalPause | null;
  recentRunFingerprints: string[];
};

export type GoalState = {
  createdAt: number;
  id: string;
  objective: string;
  safety: GoalSafetyState;
  status: GoalStatus;
  timeUsedSeconds: number;
  tokenBudget: number | null;
  tokensUsed: number;
  updatedAt: number;
  version: 1;
};

export type GoalEventKind =
  | "active"
  | "continuation"
  | "paused"
  | "resumed"
  | "cleared"
  | "budget_limited"
  | "complete";

const FINGERPRINT_PATTERN = /^v1:[0-9a-f]{64}$/u;
const TOKEN_BUDGET_PATTERN = /(?:^|\s)--tokens(?:=|\s+)(\S+\s*[kKmM]?)(?:\s|$)/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return (
    value === "active" || value === "paused" || value === "budget_limited" || value === "complete"
  );
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function simplePause(value: Readonly<Record<string, unknown>>): GoalPause | undefined {
  const reason = value["reason"];
  if (
    reason !== "user" &&
    reason !== "reload" &&
    reason !== "interrupted" &&
    reason !== "terminal_error"
  ) {
    return undefined;
  }
  return exactKeys(value, ["reason"]) ? { reason } : undefined;
}

function loopGuardPause(value: Readonly<Record<string, unknown>>): GoalPause | undefined {
  if (value["reason"] !== "loop_guard") return undefined;
  const action = value["action"];
  return (action === "nudge" || action === "trip") && exactKeys(value, ["action", "reason"])
    ? { action, reason: "loop_guard" }
    : undefined;
}

function repeatedCyclePause(value: Readonly<Record<string, unknown>>): GoalPause | undefined {
  if (value["reason"] !== "repeated_cycle") return undefined;
  const cycleLength = nonnegativeInteger(value["cycleLength"]);
  const repetitions = nonnegativeInteger(value["repetitions"]);
  if (
    cycleLength === undefined ||
    cycleLength < 1 ||
    repetitions === undefined ||
    repetitions < 2 ||
    !exactKeys(value, ["cycleLength", "reason", "repetitions"])
  ) {
    return undefined;
  }
  return { cycleLength, reason: "repeated_cycle", repetitions };
}

function checkpointPause(value: Readonly<Record<string, unknown>>): GoalPause | undefined {
  if (value["reason"] !== "checkpoint") return undefined;
  const runLimit = nonnegativeInteger(value["runLimit"]);
  if (runLimit === undefined || runLimit < 1 || !exactKeys(value, ["reason", "runLimit"])) {
    return undefined;
  }
  return { reason: "checkpoint", runLimit };
}

export function normalizeGoalPause(value: unknown): GoalPause | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  return (
    simplePause(value) ??
    loopGuardPause(value) ??
    repeatedCyclePause(value) ??
    checkpointPause(value)
  );
}

export function createGoalSafetyState(): GoalSafetyState {
  return {
    automaticRunCount: 0,
    checkpointRunCount: 0,
    pause: null,
    recentRunFingerprints: [],
  };
}

function normalizeFingerprints(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > FINGERPRINT_HISTORY_LIMIT) return undefined;
  const fingerprints: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !FINGERPRINT_PATTERN.test(item)) return undefined;
    fingerprints.push(item);
  }
  return fingerprints;
}

function buildSafetyState(
  automaticRunCount: number | undefined,
  checkpointRunCount: number | undefined,
  pause: GoalPause | null | undefined,
  fingerprints: string[] | undefined,
): GoalSafetyState | undefined {
  if (automaticRunCount === undefined || checkpointRunCount === undefined) return undefined;
  if (pause === undefined || fingerprints === undefined) return undefined;
  return {
    automaticRunCount,
    checkpointRunCount,
    pause,
    recentRunFingerprints: fingerprints,
  };
}

function normalizeGoalSafety(value: unknown): GoalSafetyState | undefined {
  if (value === undefined) return createGoalSafetyState();
  if (
    !isRecord(value) ||
    !exactKeys(value, ["automaticRunCount", "checkpointRunCount", "pause", "recentRunFingerprints"])
  ) {
    return undefined;
  }
  const automaticRunCount = nonnegativeInteger(value["automaticRunCount"]);
  const checkpointRunCount = nonnegativeInteger(value["checkpointRunCount"]);
  const pause = normalizeGoalPause(value["pause"]);
  const fingerprints = normalizeFingerprints(value["recentRunFingerprints"]);
  return buildSafetyState(automaticRunCount, checkpointRunCount, pause, fingerprints);
}

function normalizedTokenBudget(value: unknown): number | null | undefined {
  if (value === null) return null;
  const budget = nonnegativeInteger(value);
  return budget !== undefined && budget > 0 ? budget : undefined;
}

type GoalIdentity = Pick<GoalState, "id" | "objective" | "status">;
type GoalUsage = Pick<GoalState, "timeUsedSeconds" | "tokenBudget" | "tokensUsed">;
type GoalTimes = Pick<GoalState, "createdAt" | "updatedAt">;

function normalizeGoalIdentity(value: Readonly<Record<string, unknown>>): GoalIdentity | undefined {
  const id = value["id"];
  const objective = value["objective"];
  const status = value["status"];
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof objective !== "string" || objective.trim().length === 0) return undefined;
  return isGoalStatus(status) ? { id, objective, status } : undefined;
}

function normalizeGoalUsage(value: Readonly<Record<string, unknown>>): GoalUsage | undefined {
  const tokenBudget = normalizedTokenBudget(value["tokenBudget"]);
  const tokensUsed = nonnegativeInteger(value["tokensUsed"]);
  const timeUsedSeconds = nonnegativeInteger(value["timeUsedSeconds"]);
  return tokenBudget === undefined || tokensUsed === undefined || timeUsedSeconds === undefined
    ? undefined
    : { timeUsedSeconds, tokenBudget, tokensUsed };
}

function normalizeGoalTimes(value: Readonly<Record<string, unknown>>): GoalTimes | undefined {
  const createdAt = finiteNumber(value["createdAt"]);
  const updatedAt = finiteNumber(value["updatedAt"]);
  return createdAt === undefined || updatedAt === undefined ? undefined : { createdAt, updatedAt };
}

export function normalizeGoalState(value: unknown): GoalState | undefined {
  if (!isRecord(value) || value["version"] !== 1) return undefined;
  const identity = normalizeGoalIdentity(value);
  const usage = normalizeGoalUsage(value);
  const times = normalizeGoalTimes(value);
  const safety = normalizeGoalSafety(value["safety"]);
  return identity && usage && times && safety
    ? { ...identity, ...usage, ...times, safety, version: 1 }
    : undefined;
}

function parsedTokenBudget(raw: string): number | undefined {
  const suffix = raw.slice(-1).toLowerCase();
  let multiplier = 1;
  let numeric = raw;
  if (suffix === "m") {
    multiplier = 1_000_000;
    numeric = raw.slice(0, -1);
  } else if (suffix === "k") {
    multiplier = 1_000;
    numeric = raw.slice(0, -1);
  }
  const value = Number(numeric);
  return Number.isFinite(value) && value > 0 ? Math.round(value * multiplier) : undefined;
}

export function parseTokenBudget(input: string): {
  error?: string;
  objective: string;
  tokenBudget: number | null;
} {
  const match = TOKEN_BUDGET_PATTERN.exec(input);
  if (!match) return { objective: input.trim(), tokenBudget: null };

  const tokenBudget = parsedTokenBudget((match[1] ?? "").replace(/\s+/gu, ""));
  if (tokenBudget === undefined) {
    return { error: "Token budget must be positive.", objective: input.trim(), tokenBudget: null };
  }
  const matchIndex = match.index;
  const objective =
    `${input.slice(0, matchIndex)} ${input.slice(matchIndex + match[0].length)}`.trim();
  return { objective, tokenBudget };
}

export function normalizeTokenBudget(value: unknown): {
  error?: string;
  tokenBudget: number | null;
} {
  if (value === undefined || value === null) return { tokenBudget: null };
  const tokenBudget = Math.round(Number(value));
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
    return { error: "tokenBudget must be a positive number when provided.", tokenBudget: null };
  }
  return { tokenBudget };
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${String(Math.round(value / 100_000) / 10)}M`;
  if (value >= 1_000) return `${String(Math.round(value / 100) / 10)}K`;
  return String(value);
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${String(hours)}h ${String(remMinutes)}m` : `${String(hours)}h`;
}

export function pauseLabel(pause: GoalPause | null): string {
  if (!pause) return "paused";
  if (pause.reason === "repeated_cycle") {
    return `paused after a repeated ${String(pause.cycleLength)}-run cycle`;
  }
  if (pause.reason === "checkpoint") {
    return `paused at the ${String(pause.runLimit)}-run checkpoint`;
  }
  if (pause.reason === "loop_guard") {
    return `paused after Loop Guard ${pause.action === "nudge" ? "intervened" : "tripped"}`;
  }
  const labels: Record<
    Exclude<GoalPause["reason"], "repeated_cycle" | "checkpoint" | "loop_guard">,
    string
  > = {
    interrupted: "paused after interruption",
    reload: "paused after reload",
    terminal_error: "paused after terminal error",
    user: "paused by user",
  };
  return labels[pause.reason];
}

export function statusLine(state: GoalState | null): string | undefined {
  if (!state) return undefined;
  const budget = state.tokenBudget
    ? ` (${formatTokens(state.tokensUsed)} / ${formatTokens(state.tokenBudget)})`
    : ` (${formatElapsed(state.timeUsedSeconds)})`;
  if (state.status === "active") return `Pursuing goal${budget}`;
  if (state.status === "paused") return `Goal ${pauseLabel(state.safety.pause)} (/goal resume)`;
  if (state.status === "budget_limited") return `Goal unmet${budget}`;
  return `Goal achieved${budget}`;
}

export function goalUsage(state: GoalState): string {
  if (state.tokenBudget !== null) {
    return `${formatTokens(state.tokensUsed)} / ${formatTokens(state.tokenBudget)} tokens`;
  }
  return formatElapsed(state.timeUsedSeconds);
}

export function truncateObjective(objective: string, max = 96): string {
  const singleLine = objective.replace(/\s+/gu, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

export function goalEventStatus(kind: GoalEventKind, state?: GoalState): string {
  if (kind === "paused") return pauseLabel(state?.safety.pause ?? null);
  const labels: Record<Exclude<GoalEventKind, "paused">, string> = {
    active: "active",
    budget_limited: "budget reached",
    cleared: "cleared",
    complete: "achieved",
    continuation: "continuing",
    resumed: "resumed",
  };
  return labels[kind];
}

export function createGoalState(
  objective: string,
  tokenBudget: number | null,
  now = Date.now(),
  random = Math.random(),
): GoalState {
  return {
    createdAt: now,
    id: `${String(now)}-${random.toString(16).slice(2)}`,
    objective,
    safety: createGoalSafetyState(),
    status: "active",
    timeUsedSeconds: 0,
    tokenBudget,
    tokensUsed: 0,
    updatedAt: now,
    version: 1,
  };
}

export function accountGoalUsage(
  state: GoalState,
  tokenDelta: number,
  elapsedSeconds: number,
  now = Date.now(),
): GoalState {
  const tokensUsed = state.tokensUsed + Math.max(0, Math.round(tokenDelta));
  const timeUsedSeconds = state.timeUsedSeconds + Math.max(0, Math.round(elapsedSeconds));
  const budgetReached =
    state.status === "active" && state.tokenBudget !== null && tokensUsed >= state.tokenBudget;
  return {
    ...state,
    status: budgetReached ? "budget_limited" : state.status,
    timeUsedSeconds,
    tokensUsed,
    updatedAt: now,
  };
}

export function pauseGoal(state: GoalState, pause: GoalPause, now = Date.now()): GoalState {
  return {
    ...state,
    safety: { ...state.safety, pause },
    status: "paused",
    updatedAt: now,
  };
}

export function resumeGoal(state: GoalState, now = Date.now()): GoalState {
  return {
    ...state,
    safety: {
      ...state.safety,
      checkpointRunCount: 0,
      pause: null,
      recentRunFingerprints: [],
    },
    status: "active",
    updatedAt: now,
  };
}
