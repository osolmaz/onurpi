import { describe, expect, it } from "vitest";

import {
  completedPlanSteps,
  decodePlanSnapshot,
  decodeUpdatePlanInput,
  MAX_EXPLANATION_LENGTH,
  MAX_PLAN_STEPS,
  MAX_STEP_LENGTH,
  normalizeUpdatePlan,
  samePlanSnapshot,
  type UpdatePlanInput,
} from "./plan-schema.ts";

function input(overrides: Partial<UpdatePlanInput> = {}): UpdatePlanInput {
  return {
    explanation: "  Starting implementation  ",
    plan: [
      { step: "  Inspect code  ", status: "completed" },
      { step: "Implement feature", status: "in_progress" },
      { step: "Run checks", status: "pending" },
    ],
    ...overrides,
  };
}

describe("normalizeUpdatePlan", () => {
  it("normalizes a complete snapshot and derives progress", () => {
    const update = normalizeUpdatePlan(input());

    expect(update.explanation).toBe("Starting implementation");
    expect(update.snapshot.plan).toEqual([
      { step: "Inspect code", status: "completed" },
      { step: "Implement feature", status: "in_progress" },
      { step: "Run checks", status: "pending" },
    ]);
    expect(completedPlanSteps(update.snapshot)).toBe(1);
    expect(Object.isFrozen(update.snapshot)).toBe(true);
    expect(Object.isFrozen(update.snapshot.plan)).toBe(true);
    expect(Object.isFrozen(update.snapshot.plan[0])).toBe(true);
  });

  it("allows empty plans, duplicates, and arbitrary status transitions", () => {
    expect(normalizeUpdatePlan(input({ explanation: "  ", plan: [] }))).toEqual({
      snapshot: { plan: [] },
    });
    expect(
      normalizeUpdatePlan(
        input({
          plan: [
            { step: "Repeat", status: "completed" },
            { step: "Repeat", status: "pending" },
          ],
        }),
      ).snapshot.plan,
    ).toHaveLength(2);
  });

  it("rejects blank, oversized, and multiply active plans", () => {
    expect(() => normalizeUpdatePlan(input({ plan: [{ step: "  ", status: "pending" }] }))).toThrow(
      "must not be blank",
    );
    expect(() =>
      normalizeUpdatePlan(
        input({ plan: [{ step: "x".repeat(MAX_STEP_LENGTH + 1), status: "pending" }] }),
      ),
    ).toThrow("at most 500 characters");
    expect(() =>
      normalizeUpdatePlan(
        input({
          plan: [
            { step: "First", status: "in_progress" },
            { step: "Second", status: "in_progress" },
          ],
        }),
      ),
    ).toThrow("at most one in_progress");
    expect(() =>
      normalizeUpdatePlan(
        input({
          plan: Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, index) => ({
            step: `Step ${String(index)}`,
            status: "pending" as const,
          })),
        }),
      ),
    ).toThrow("at most 64 steps");
    expect(() =>
      normalizeUpdatePlan(input({ explanation: "x".repeat(MAX_EXPLANATION_LENGTH + 1) })),
    ).toThrow("at most 2000 characters");
  });
});

describe("strict decoders", () => {
  it("accepts canonical stored details and normalized tool arguments", () => {
    expect(decodePlanSnapshot({ plan: [{ step: "Run checks", status: "in_progress" }] })).toEqual({
      plan: [{ step: "Run checks", status: "in_progress" }],
    });
    expect(
      decodeUpdatePlanInput({
        explanation: "  Why  ",
        plan: [{ step: "  Run checks  ", status: "pending" }],
      }),
    ).toEqual({
      explanation: "Why",
      snapshot: { plan: [{ step: "Run checks", status: "pending" }] },
    });
  });

  it("rejects malformed and noncanonical persisted values", () => {
    const malformed = [
      undefined,
      null,
      [],
      {},
      { plan: "no" },
      { plan: [], extra: true },
      { plan: [{ step: "Run", status: "unknown" }] },
      { plan: [{ step: " Run ", status: "pending" }] },
      { plan: [{ step: "", status: "pending" }] },
      {
        plan: [
          { step: "First", status: "in_progress" },
          { step: "Second", status: "in_progress" },
        ],
      },
    ];
    for (const value of malformed) expect(decodePlanSnapshot(value)).toBeUndefined();

    expect(decodeUpdatePlanInput({ plan: [], extra: true })).toBeUndefined();
    expect(decodeUpdatePlanInput({ plan: [], explanation: 3 })).toBeUndefined();
    expect(
      decodeUpdatePlanInput({ plan: [], explanation: "x".repeat(MAX_EXPLANATION_LENGTH + 1) }),
    ).toBeUndefined();
  });
});

describe("samePlanSnapshot", () => {
  it("compares ordered text and status", () => {
    const left = decodePlanSnapshot({ plan: [{ step: "Run", status: "pending" }] });
    const same = decodePlanSnapshot({ plan: [{ step: "Run", status: "pending" }] });
    const changed = decodePlanSnapshot({ plan: [{ step: "Run", status: "completed" }] });

    expect(samePlanSnapshot(left, same)).toBe(true);
    expect(samePlanSnapshot(left, changed)).toBe(false);
    expect(samePlanSnapshot(left, undefined)).toBe(false);
    expect(samePlanSnapshot(undefined, undefined)).toBe(true);
  });
});
