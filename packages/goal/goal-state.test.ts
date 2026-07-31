import { describe, expect, it } from "vitest";

import {
  accountGoalUsage,
  createGoalSafetyState,
  createGoalState,
  formatElapsed,
  formatTokens,
  goalEventStatus,
  goalUsage,
  normalizeGoalPause,
  normalizeGoalState,
  normalizeTokenBudget,
  parseTokenBudget,
  pauseGoal,
  pauseLabel,
  resumeGoal,
  statusLine,
  truncateObjective,
} from "./goal-state.ts";

function upstreamState(): Record<string, unknown> {
  return {
    createdAt: 42,
    id: "goal-1",
    objective: "ship it",
    status: "active",
    timeUsedSeconds: 0,
    tokenBudget: null,
    tokensUsed: 0,
    updatedAt: 42,
    version: 1,
  };
}

describe("goal state parsing", () => {
  it("parses token budgets and preserves invalid input", () => {
    expect(parseTokenBudget("  finish the migration  ")).toEqual({
      objective: "finish the migration",
      tokenBudget: null,
    });
    expect(parseTokenBudget("--tokens=50k finish migration")).toEqual({
      objective: "finish migration",
      tokenBudget: 50_000,
    });
    expect(parseTokenBudget("finish --tokens 1.5m migration")).toEqual({
      objective: "finish migration",
      tokenBudget: 1_500_000,
    });
    expect(parseTokenBudget("finish --tokens 250 migration")).toEqual({
      objective: "finish migration",
      tokenBudget: 250,
    });
    expect(parseTokenBudget("ship --tokens 0 now")).toEqual({
      error: "Token budget must be positive.",
      objective: "ship --tokens 0 now",
      tokenBudget: null,
    });
  });

  it("normalizes optional positive tool budgets", () => {
    expect(normalizeTokenBudget(undefined)).toEqual({ tokenBudget: null });
    expect(normalizeTokenBudget(null)).toEqual({ tokenBudget: null });
    expect(normalizeTokenBudget("1500.4")).toEqual({ tokenBudget: 1500 });
    expect(normalizeTokenBudget(0)).toEqual({
      error: "tokenBudget must be a positive number when provided.",
      tokenBudget: null,
    });
  });

  it("restores upstream version-one state with default safety", () => {
    expect(normalizeGoalState(upstreamState())).toEqual({
      ...upstreamState(),
      safety: createGoalSafetyState(),
    });
  });

  it("rejects malformed state and safety data", () => {
    expect(normalizeGoalState(null)).toBeUndefined();
    expect(normalizeGoalState({ ...upstreamState(), version: 2 })).toBeUndefined();
    expect(normalizeGoalState({ ...upstreamState(), objective: " " })).toBeUndefined();
    expect(normalizeGoalState({ ...upstreamState(), status: "unknown" })).toBeUndefined();
    expect(normalizeGoalState({ ...upstreamState(), tokenBudget: 0 })).toBeUndefined();
    expect(normalizeGoalState({ ...upstreamState(), tokensUsed: -1 })).toBeUndefined();
    expect(
      normalizeGoalState({
        ...upstreamState(),
        safety: {
          automaticRunCount: 1,
          checkpointRunCount: 1,
          pause: null,
          recentRunFingerprints: ["raw-content"],
        },
      }),
    ).toBeUndefined();
  });

  it("validates every pause shape strictly", () => {
    expect(normalizeGoalPause(null)).toBeNull();
    expect(normalizeGoalPause({ reason: "user" })).toEqual({ reason: "user" });
    expect(normalizeGoalPause({ action: "trip", reason: "loop_guard" })).toEqual({
      action: "trip",
      reason: "loop_guard",
    });
    expect(normalizeGoalPause({ action: "unknown", reason: "loop_guard" })).toBeUndefined();
    expect(
      normalizeGoalPause({ cycleLength: 2, reason: "repeated_cycle", repetitions: 3 }),
    ).toEqual({ cycleLength: 2, reason: "repeated_cycle", repetitions: 3 });
    expect(normalizeGoalPause({ reason: "checkpoint", runLimit: 20 })).toEqual({
      reason: "checkpoint",
      runLimit: 20,
    });
    expect(normalizeGoalPause({ reason: "checkpoint" })).toBeUndefined();
    expect(normalizeGoalPause({ extra: true, reason: "user" })).toBeUndefined();
  });
});

describe("goal state transitions", () => {
  it("creates deterministic active state", () => {
    expect(createGoalState("ship it", 123, 42, 0.5)).toEqual({
      createdAt: 42,
      id: "42-8",
      objective: "ship it",
      safety: createGoalSafetyState(),
      status: "active",
      timeUsedSeconds: 0,
      tokenBudget: 123,
      tokensUsed: 0,
      updatedAt: 42,
      version: 1,
    });
  });

  it("accounts one settled run and enforces the token budget", () => {
    const goal = createGoalState("ship it", 100, 42, 0.5);
    expect(accountGoalUsage(goal, 70, 5, 50)).toMatchObject({
      status: "active",
      timeUsedSeconds: 5,
      tokensUsed: 70,
      updatedAt: 50,
    });
    expect(accountGoalUsage(goal, 100, 5, 50).status).toBe("budget_limited");
    expect(accountGoalUsage(goal, -10, -5, 50)).toMatchObject({
      timeUsedSeconds: 0,
      tokensUsed: 0,
    });
  });

  it("preserves complete status while accounting final usage", () => {
    const complete = { ...createGoalState("ship it", 100, 42, 0.5), status: "complete" as const };
    expect(accountGoalUsage(complete, 25, 7, 55)).toMatchObject({
      status: "complete",
      timeUsedSeconds: 7,
      tokensUsed: 25,
    });
  });

  it("records pause evidence and resets only the checkpoint epoch on resume", () => {
    const state = createGoalState("ship it", null, 42, 0.5);
    state.safety.automaticRunCount = 9;
    state.safety.checkpointRunCount = 4;
    state.safety.recentRunFingerprints = [`v1:${"a".repeat(64)}`];
    const paused = pauseGoal(state, { reason: "checkpoint", runLimit: 20 }, 50);
    expect(paused.status).toBe("paused");
    expect(resumeGoal(paused, 60)).toMatchObject({
      safety: {
        automaticRunCount: 9,
        checkpointRunCount: 0,
        pause: null,
        recentRunFingerprints: [],
      },
      status: "active",
      updatedAt: 60,
    });
  });
});

describe("goal display formatting", () => {
  it("formats tokens and elapsed time", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_340)).toBe("12.3K");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatElapsed(59)).toBe("59s");
    expect(formatElapsed(60)).toBe("1m");
    expect(formatElapsed(5_460)).toBe("1h 31m");
  });

  it("describes every status and pause reason", () => {
    const active = createGoalState("ship it", null, 42, 0.5);
    expect(statusLine(active)).toBe("Pursuing goal (0s)");
    expect(statusLine(pauseGoal(active, { reason: "interrupted" }, 50))).toBe(
      "Goal paused after interruption (/goal resume)",
    );
    expect(pauseLabel({ cycleLength: 2, reason: "repeated_cycle", repetitions: 3 })).toBe(
      "paused after a repeated 2-run cycle",
    );
    expect(pauseLabel({ reason: "checkpoint", runLimit: 20 })).toBe(
      "paused at the 20-run checkpoint",
    );
    expect(pauseLabel({ action: "nudge", reason: "loop_guard" })).toBe(
      "paused after Loop Guard intervened",
    );
    expect(pauseLabel({ action: "trip", reason: "loop_guard" })).toBe(
      "paused after Loop Guard tripped",
    );
    expect(statusLine({ ...active, status: "budget_limited" })).toBe("Goal unmet (0s)");
    expect(statusLine({ ...active, status: "complete" })).toBe("Goal achieved (0s)");
    expect(statusLine(null)).toBeUndefined();
  });

  it("formats event labels, usage, and objectives", () => {
    const budgeted = createGoalState("ship it", 1000, 42, 0.5);
    budgeted.tokensUsed = 250;
    expect(goalUsage(budgeted)).toBe("250 / 1K tokens");
    expect(goalEventStatus("continuation")).toBe("continuing");
    expect(goalEventStatus("complete")).toBe("achieved");
    expect(truncateObjective("  one\n two\tthree  ")).toBe("one two three");
    expect(truncateObjective("abcdef", 4)).toBe("abc…");
  });
});
