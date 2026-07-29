import { describe, expect, it } from "vitest";

import { GOAL_STATE_ENTRY, latestGoalState } from "./goal-replay.ts";
import { createGoalSafetyState, createGoalState } from "./goal-state.ts";

function entry(id: string, data: unknown, customType = GOAL_STATE_ENTRY): unknown {
  return { customType, data, id, type: "custom" };
}

describe("goal state replay", () => {
  it("restores the latest valid branch snapshot", () => {
    const first = createGoalState("first", null, 1, 0.5);
    const second = createGoalState("second", 100, 2, 0.5);
    expect(
      latestGoalState([
        entry("1", { goal: first, statusBarEnabled: true }),
        entry("2", { goal: second, statusBarEnabled: false }),
      ]),
    ).toEqual({ goal: second, statusBarEnabled: false });
  });

  it("restores upstream state without safety fields", () => {
    const upstream = {
      createdAt: 1,
      id: "old",
      objective: "old goal",
      status: "active",
      timeUsedSeconds: 3,
      tokenBudget: null,
      tokensUsed: 2,
      updatedAt: 2,
      version: 1,
    };
    expect(latestGoalState([entry("1", { goal: upstream })])).toEqual({
      goal: { ...upstream, safety: createGoalSafetyState() },
      statusBarEnabled: true,
    });
  });

  it("skips malformed and unrelated entries", () => {
    const valid = createGoalState("valid", null, 1, 0.5);
    expect(
      latestGoalState([
        entry("1", { goal: valid }),
        entry("2", { goal: { version: 2 } }),
        entry("3", { goal: null }, "other"),
      ]),
    ).toEqual({ goal: valid, statusBarEnabled: true });
    expect(latestGoalState([entry("1", { goal: null, statusBarEnabled: "yes" })])).toEqual({
      goal: null,
      statusBarEnabled: true,
    });
  });

  it("restores an explicit cleared state", () => {
    expect(latestGoalState([entry("1", { goal: null, statusBarEnabled: false })])).toEqual({
      goal: null,
      statusBarEnabled: false,
    });
  });
});
