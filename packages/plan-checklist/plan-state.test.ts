import { describe, expect, it } from "vitest";

import { decodePlanSnapshot } from "./plan-schema.ts";
import { PlanState } from "./plan-state.ts";

describe("PlanState", () => {
  it("applies normalized updates and clears empty plans", () => {
    const state = new PlanState();
    const update = state.apply(
      {
        explanation: "  Work started  ",
        plan: [{ step: "  Implement  ", status: "in_progress" }],
      },
      100,
    );

    expect(update).toEqual({
      explanation: "Work started",
      snapshot: { plan: [{ step: "Implement", status: "in_progress" }] },
    });
    expect(state.get()).toEqual({ revision: 1, snapshot: update.snapshot, sourceTimestamp: 100 });

    state.apply({ plan: [] }, 200);
    expect(state.get()).toEqual({ revision: 2 });
  });

  it("updates provenance without invalidating an unchanged projection", () => {
    const state = new PlanState();
    const first = decodePlanSnapshot({ plan: [{ step: "Run", status: "pending" }] });
    const second = decodePlanSnapshot({ plan: [{ step: "Run", status: "pending" }] });
    if (!first || !second) throw new Error("Expected valid fixtures");

    expect(state.replace(first, 10)).toBe(true);
    expect(state.replace(second, 20)).toBe(false);
    expect(state.get()).toEqual({ revision: 1, snapshot: second, sourceTimestamp: 20 });
    expect(state.clear()).toBe(true);
    expect(state.clear()).toBe(false);
  });

  it("leaves the prior state intact when validation fails", () => {
    const state = new PlanState();
    state.apply({ plan: [{ step: "Run", status: "pending" }] }, 10);

    expect(() =>
      state.apply(
        {
          plan: [
            { step: "One", status: "in_progress" },
            { step: "Two", status: "in_progress" },
          ],
        },
        20,
      ),
    ).toThrow("at most one in_progress");
    expect(state.get()).toEqual({
      revision: 1,
      snapshot: { plan: [{ step: "Run", status: "pending" }] },
      sourceTimestamp: 10,
    });
  });
});
