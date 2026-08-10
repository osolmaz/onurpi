import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveReviewTimePolicy,
  runReviewWithBudget,
  workerHardTimeoutMs,
} from "../src/review-budget.js";

const TOOL_EVENT: AgentSessionEvent = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "custom",
    model: "review-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("review time policy", () => {
  it("normalizes percentage and duration warnings", () => {
    const policy = resolveReviewTimePolicy(
      30 * 60_000,
      [
        { kind: "percentage", percentage: 50 },
        { kind: "duration", milliseconds: 10 * 60_000 },
        { kind: "duration", milliseconds: 5 * 60_000 },
      ],
      10 * 60_000,
    );
    expect(policy).toEqual({
      timeBudgetMs: 30 * 60_000,
      warningRemainingMs: [15 * 60_000, 10 * 60_000, 5 * 60_000],
      finalizationGraceMs: 10 * 60_000,
    });
    expect(workerHardTimeoutMs(policy)).toBe(45 * 60_000);
    expect(resolveReviewTimePolicy(1_000).warningRemainingMs).toEqual([500, 250]);
  });

  it("rejects duplicate and out-of-range warnings", () => {
    expect(() =>
      resolveReviewTimePolicy(60_000, [
        { kind: "percentage", percentage: 50 },
        { kind: "duration", milliseconds: 30_000 },
      ]),
    ).toThrow("unique");
    expect(() =>
      resolveReviewTimePolicy(60_000, [{ kind: "duration", milliseconds: 60_000 }]),
    ).toThrow("before the time budget ends");
  });
});

describe("review budget controller", () => {
  it("coalesces warnings and cancels timers after an early submission", async () => {
    vi.useFakeTimers();
    let submitted = false;
    let finishInitial: () => void = () => undefined;
    const steers: string[] = [];
    let clears = 0;
    const review = runReviewWithBudget(
      {
        abort: () => Promise.resolve(),
        clearQueue: () => {
          clears += 1;
          return { steering: [], followUp: [] };
        },
        prompt: () =>
          new Promise<void>((resolve) => {
            finishInitial = resolve;
          }),
        setActiveToolsByName: () => undefined,
        steer: (message) => {
          steers.push(message);
          return Promise.resolve();
        },
        subscribe: () => () => undefined,
      },
      "Review",
      {
        timeBudgetMs: 100_000,
        warningRemainingMs: [50_000, 25_000],
        finalizationGraceMs: 20_000,
      },
      null,
      () => submitted,
    );

    await vi.advanceTimersByTimeAsync(50_000);
    expect(steers.at(-1)).toContain("50s remain");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(steers.at(-1)).toContain("25s remain");
    expect(clears).toBe(2);
    submitted = true;
    finishInitial();
    await expect(review).resolves.toBeNull();
    await vi.runAllTimersAsync();
    expect(steers).toHaveLength(2);
  });

  it("turns the time deadline into one tool-only finalization request", async () => {
    vi.useFakeTimers();
    let submitted = false;
    let finishInitial: () => void = () => undefined;
    const prompts: string[] = [];
    const tools: string[][] = [];
    let aborts = 0;
    const review = runReviewWithBudget(
      {
        abort: () => {
          aborts += 1;
          finishInitial();
          return Promise.resolve();
        },
        clearQueue: () => ({ steering: [], followUp: [] }),
        prompt: (message) => {
          prompts.push(message);
          if (prompts.length === 1) {
            return new Promise<void>((resolve) => {
              finishInitial = resolve;
            });
          }
          submitted = true;
          return Promise.resolve();
        },
        setActiveToolsByName: (names) => {
          tools.push(names);
        },
        steer: () => Promise.resolve(),
        subscribe: () => () => undefined,
      },
      "Review",
      { timeBudgetMs: 60_000, warningRemainingMs: [], finalizationGraceMs: 20_000 },
      null,
      () => submitted,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(review).resolves.toBe("time_budget");
    expect(aborts).toBe(1);
    expect(tools).toEqual([["submit_review"]]);
    expect(prompts[0]).toContain("Review time budget: 1m");
    expect(prompts[1]).toContain("time budget has ended");
  });
});

describe("review budget finalization failures", () => {
  it("shares finalization between request and time budgets", async () => {
    vi.useFakeTimers();
    let submitted = false;
    let finishInitial: () => void = () => undefined;
    let listener: (event: AgentSessionEvent) => void = () => undefined;
    let finalPrompts = 0;
    let steers = 0;
    const review = runReviewWithBudget(
      {
        abort: () => {
          finishInitial();
          return Promise.resolve();
        },
        clearQueue: () => ({ steering: [], followUp: [] }),
        prompt: () => {
          if (finalPrompts === 0) {
            finalPrompts += 1;
            return new Promise<void>((resolve) => {
              finishInitial = resolve;
            });
          }
          submitted = true;
          finalPrompts += 1;
          return Promise.resolve();
        },
        setActiveToolsByName: () => undefined,
        steer: () => {
          steers += 1;
          return Promise.resolve();
        },
        subscribe: (next) => {
          listener = next;
          return () => undefined;
        },
      },
      "Review",
      { timeBudgetMs: 60_000, warningRemainingMs: [], finalizationGraceMs: 20_000 },
      1,
      () => submitted,
    );

    listener(TOOL_EVENT);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(review).resolves.toBe("model_request_limit");
    expect(finalPrompts).toBe(2);
    expect(steers).toBe(0);
  });

  it("fails explicitly when finalization grace expires", async () => {
    vi.useFakeTimers();
    let finishInitial: () => void = () => undefined;
    let promptCount = 0;
    const review = runReviewWithBudget(
      {
        abort: () => {
          finishInitial();
          return Promise.resolve();
        },
        clearQueue: () => ({ steering: [], followUp: [] }),
        prompt: () => {
          promptCount += 1;
          if (promptCount === 1) {
            return new Promise<void>((resolve) => {
              finishInitial = resolve;
            });
          }
          return new Promise<void>(() => undefined);
        },
        setActiveToolsByName: () => undefined,
        steer: () => Promise.resolve(),
        subscribe: () => () => undefined,
      },
      "Review",
      { timeBudgetMs: 10_000, warningRemainingMs: [], finalizationGraceMs: 5_000 },
      null,
      () => false,
    );

    const rejection = expect(review).rejects.toThrow("finalization exceeded 5s");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });
});
