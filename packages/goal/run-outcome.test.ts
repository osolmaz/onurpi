import { describe, expect, it } from "vitest";

import { AUTOMATIC_RUN_LIMIT, createGoalState, pauseGoal } from "./goal-state.ts";
import {
  createRunObservation,
  recordSettledRun,
  repeatedCycleLength,
  runFingerprint,
  terminalRunState,
  type RunObservation,
} from "./run-outcome.ts";

function fingerprint(character: string): string {
  return `v1:${character.repeat(64)}`;
}

function observation(overrides: Partial<RunObservation> = {}): RunObservation {
  return {
    aborted: false,
    elapsedSeconds: 2,
    fingerprint: fingerprint("a"),
    terminalError: false,
    tokenDelta: 10,
    ...overrides,
  };
}

describe("run fingerprints", () => {
  it("ignores volatile IDs, timestamps, usage, provider, and model", () => {
    const first = [
      {
        content: [{ arguments: { path: "a.ts" }, id: "call-1", name: "read", type: "toolCall" }],
        model: "first",
        provider: "provider-a",
        responseId: "response-a",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 1,
        usage: { totalTokens: 10 },
      },
    ];
    const second = [
      {
        content: [{ arguments: { path: "a.ts" }, id: "call-2", name: "read", type: "toolCall" }],
        model: "second",
        provider: "provider-b",
        responseId: "response-b",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 2,
        usage: { totalTokens: 999 },
      },
    ];
    expect(runFingerprint(first)).toBe(runFingerprint(second));
  });

  it("ignores user and custom trigger messages", () => {
    const active = [
      { content: "active", details: { kind: "active" }, role: "custom" },
      { content: [{ text: "same", type: "text" }], role: "assistant" },
    ];
    const continuation = [
      { content: "continue", details: { kind: "continuation" }, role: "custom" },
      { content: [{ text: "same", type: "text" }], role: "assistant" },
    ];
    expect(runFingerprint(active)).toBe(runFingerprint(continuation));
  });

  it("changes when observable commands, results, or nested IDs change", () => {
    const left = [{ content: [{ text: "left", type: "text" }], role: "assistant" }];
    const right = [{ content: [{ text: "right", type: "text" }], role: "assistant" }];
    expect(runFingerprint(left)).not.toBe(runFingerprint(right));

    const firstResult = [
      { details: { created: { id: "issue-1" } }, role: "toolResult", toolCallId: "call-1" },
    ];
    const secondResult = [
      { details: { created: { id: "issue-2" } }, role: "toolResult", toolCallId: "call-2" },
    ];
    expect(runFingerprint(firstResult)).not.toBe(runFingerprint(secondResult));
  });

  it("bounds very long strings and unusual values deterministically", () => {
    const long = "x".repeat(40_000);
    const value = [{ content: [long, Number.POSITIVE_INFINITY, undefined, () => true] }];
    expect(runFingerprint(value)).toMatch(/^v1:[0-9a-f]{64}$/u);
    expect(runFingerprint(value)).toBe(runFingerprint(value));
  });
});

describe("terminal run state", () => {
  it("uses the last assistant outcome after retries", () => {
    expect(
      terminalRunState([
        { role: "assistant", stopReason: "error" },
        { role: "toolResult" },
        { role: "assistant", stopReason: "stop" },
      ]),
    ).toEqual({ aborted: false, terminalError: false });
    expect(terminalRunState([{ role: "assistant", stopReason: "aborted" }])).toEqual({
      aborted: true,
      terminalError: false,
    });
    expect(terminalRunState([{ role: "assistant", stopReason: "error" }])).toEqual({
      aborted: false,
      terminalError: true,
    });
    expect(terminalRunState([{ role: "toolResult" }])).toEqual({
      aborted: false,
      terminalError: false,
    });
  });

  it("creates a normalized observation", () => {
    expect(
      createRunObservation([{ role: "assistant", stopReason: "stop" }], -10, 1.6),
    ).toMatchObject({ aborted: false, elapsedSeconds: 2, terminalError: false, tokenDelta: 0 });
  });
});

describe("cycle detection", () => {
  it("detects repeated one-run and two-run suffixes", () => {
    expect(repeatedCycleLength(["a", "a", "a"])).toBe(1);
    expect(repeatedCycleLength(["x", "a", "b", "a", "b", "a", "b"])).toBe(2);
    expect(repeatedCycleLength(["a", "b", "a", "b"])).toBeUndefined();
  });

  it("checks shorter periods first", () => {
    expect(repeatedCycleLength(["a", "a", "a", "a", "a", "a"])).toBe(1);
  });
});

describe("settled run safety", () => {
  it("accounts usage and records a compact fingerprint", () => {
    const goal = createGoalState("ship it", null, 42, 0.5);
    const result = recordSettledRun(goal, observation(), 50);
    expect(result.pause).toBeNull();
    expect(result.state).toMatchObject({
      safety: {
        automaticRunCount: 1,
        checkpointRunCount: 1,
        pause: null,
        recentRunFingerprints: [fingerprint("a")],
      },
      timeUsedSeconds: 2,
      tokensUsed: 10,
    });
  });

  it("pauses after three identical outcomes", () => {
    let goal = createGoalState("ship it", null, 42, 0.5);
    for (let run = 0; run < 3; run += 1)
      goal = recordSettledRun(goal, observation(), 50 + run).state;
    expect(goal.status).toBe("paused");
    expect(goal.safety.pause).toEqual({
      cycleLength: 1,
      reason: "repeated_cycle",
      repetitions: 3,
    });
  });

  it("pauses immediately after interruption or terminal failure", () => {
    const goal = createGoalState("ship it", null, 42, 0.5);
    expect(recordSettledRun(goal, observation({ aborted: true }), 50).pause).toEqual({
      reason: "interrupted",
    });
    expect(recordSettledRun(goal, observation({ terminalError: true }), 50).pause).toEqual({
      reason: "terminal_error",
    });
  });

  it("pauses at the hard automatic-run checkpoint", () => {
    let goal = createGoalState("ship it", null, 42, 0.5);
    for (let run = 0; run < AUTOMATIC_RUN_LIMIT; run += 1) {
      const character = (run % 16).toString(16);
      goal = recordSettledRun(
        goal,
        observation({ fingerprint: fingerprint(character) }),
        50 + run,
      ).state;
      if (run < AUTOMATIC_RUN_LIMIT - 1) expect(goal.status).toBe("active");
    }
    expect(goal.status).toBe("paused");
    expect(goal.safety.pause).toEqual({
      reason: "checkpoint",
      runLimit: AUTOMATIC_RUN_LIMIT,
    });
  });

  it("lets token budget and existing non-active status take precedence", () => {
    const budgeted = createGoalState("ship it", 10, 42, 0.5);
    expect(recordSettledRun(budgeted, observation({ tokenDelta: 10 }), 50).state.status).toBe(
      "budget_limited",
    );
    const paused = pauseGoal(createGoalState("ship it", null, 42, 0.5), { reason: "user" });
    const accounted = recordSettledRun(paused, observation(), 50).state;
    expect(accounted.status).toBe("paused");
    expect(accounted.tokensUsed).toBe(10);
    expect(accounted.safety.automaticRunCount).toBe(0);
  });
});
