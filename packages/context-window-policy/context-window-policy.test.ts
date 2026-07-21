import type {
  CompactOptions,
  CompactionResult,
  ContextUsage,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  autoCompactTokenLimit,
  createContextWindowPolicyController,
  installContextWindowPolicy,
  type ContextWindowPolicyApi,
  type ContextWindowPolicyContext,
} from "./context-window-policy.ts";

const COMPACTION_RESULT: CompactionResult = {
  summary: "summary",
  firstKeptEntryId: "kept",
  tokensBefore: 244_800,
};

type ContextOptions = {
  compact?: (options: CompactOptions) => void;
  contextWindow?: number;
  idle?: boolean;
  tokens?: number | null;
};

function context(options: ContextOptions = {}): ContextWindowPolicyContext {
  const contextWindow = options.contextWindow;
  return {
    model: contextWindow === undefined ? undefined : { contextWindow },
    compact: (compactOptions = {}) => {
      options.compact?.(compactOptions);
    },
    getContextUsage: () => {
      if (options.tokens === undefined) return undefined;
      return {
        tokens: options.tokens,
        contextWindow: contextWindow ?? 272_000,
        percent: options.tokens === null ? null : 0,
      } satisfies ContextUsage;
    },
    isIdle: () => options.idle ?? true,
  };
}

function complete(options: CompactOptions | undefined): void {
  options?.onComplete?.(COMPACTION_RESULT);
}

function fail(options: CompactOptions | undefined): void {
  options?.onError?.(new Error("summary failed"));
}

type PolicyHarness = {
  agentSettled: (ctx: ContextWindowPolicyContext) => void;
  api: ContextWindowPolicyApi;
  modelSelect: (ctx: ContextWindowPolicyContext) => void;
  resets: (() => void)[];
};

function harness(): PolicyHarness {
  let agentSettled: ((ctx: ContextWindowPolicyContext) => void) | undefined;
  let modelSelect: ((ctx: ContextWindowPolicyContext) => void) | undefined;
  const resets: (() => void)[] = [];
  const api: ContextWindowPolicyApi = {
    onAgentSettled: (handler) => {
      agentSettled = handler;
    },
    onModelSelect: (handler) => {
      modelSelect = handler;
    },
    onSessionCompact: (handler) => {
      resets.push(handler);
    },
    onSessionShutdown: (handler) => {
      resets.push(handler);
    },
    onSessionStart: (handler) => {
      resets.push(handler);
    },
  };
  return {
    agentSettled: (ctx) => {
      if (!agentSettled) throw new Error("Settled handler was not registered");
      agentSettled(ctx);
    },
    api,
    modelSelect: (ctx) => {
      if (!modelSelect) throw new Error("Model handler was not registered");
      modelSelect(ctx);
    },
    resets,
  };
}

describe("autoCompactTokenLimit", () => {
  it("uses an exact nine-tenths limit across model sizes", () => {
    expect(autoCompactTokenLimit(272_000)).toBe(244_800);
    expect(autoCompactTokenLimit(200_000)).toBe(180_000);
    expect(autoCompactTokenLimit(128_000)).toBe(115_200);
    expect(autoCompactTokenLimit(101)).toBe(90);
  });

  it("rejects invalid context windows", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(autoCompactTokenLimit(value)).toBeUndefined();
    }
    expect(autoCompactTokenLimit(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it("stays within safe integer arithmetic at the largest supported window", () => {
    expect(autoCompactTokenLimit(Number.MAX_SAFE_INTEGER)).toBe(8_106_479_329_266_891);
  });
});

describe("context-window policy controller", () => {
  it("passes below the limit and triggers exactly at the limit", () => {
    const requests: CompactOptions[] = [];
    const controller = createContextWindowPolicyController();

    expect(
      controller.evaluate(
        context({
          contextWindow: 272_000,
          tokens: 244_799,
          compact: (value) => requests.push(value),
        }),
      ),
    ).toBe("below-limit");
    expect(requests).toHaveLength(0);

    expect(
      controller.evaluate(
        context({
          contextWindow: 272_000,
          tokens: 244_800,
          compact: (value) => requests.push(value),
        }),
      ),
    ).toBe("triggered");
    expect(requests).toHaveLength(1);
  });

  it("derives a fresh threshold from every selected model", () => {
    const requests: CompactOptions[] = [];
    const controller = createContextWindowPolicyController();

    expect(
      controller.evaluate(
        context({
          contextWindow: 200_000,
          tokens: 179_999,
          compact: (value) => requests.push(value),
        }),
      ),
    ).toBe("below-limit");
    expect(
      controller.evaluate(
        context({
          contextWindow: 128_000,
          tokens: 115_200,
          compact: (value) => requests.push(value),
        }),
      ),
    ).toBe("triggered");
    expect(requests).toHaveLength(1);
  });

  it("passes through missing and invalid model or usage data", () => {
    const controller = createContextWindowPolicyController();
    const cases = [
      context({ tokens: 1 }),
      context({ contextWindow: 272_000 }),
      context({ contextWindow: Number.NaN, tokens: 1 }),
      context({ contextWindow: 272_000, tokens: null }),
      context({ contextWindow: 272_000, tokens: -1 }),
      context({ contextWindow: 272_000, tokens: 1.5 }),
      context({ contextWindow: 272_000, tokens: Number.POSITIVE_INFINITY }),
      context({ contextWindow: 272_000, tokens: Number.MAX_SAFE_INTEGER + 1 }),
    ];

    for (const value of cases) expect(controller.evaluate(value)).toBe("unavailable");
  });

  it("suppresses duplicates until completion or failure", () => {
    const requests: CompactOptions[] = [];
    const controller = createContextWindowPolicyController();
    const ctx = context({
      contextWindow: 272_000,
      tokens: 244_800,
      compact: (value) => requests.push(value),
    });

    expect(controller.evaluate(ctx)).toBe("triggered");
    expect(controller.evaluate(ctx)).toBe("pending");
    complete(requests[0]);
    expect(controller.evaluate(ctx)).toBe("triggered");
    fail(requests[1]);
    expect(controller.evaluate(ctx)).toBe("triggered");
    expect(requests).toHaveLength(3);
  });

  it("releases its guard when compact throws synchronously", () => {
    const controller = createContextWindowPolicyController();
    const throwing = context({
      contextWindow: 272_000,
      tokens: 244_800,
      compact: () => {
        throw new Error("not ready");
      },
    });
    expect(() => controller.evaluate(throwing)).toThrow("not ready");

    const requests: CompactOptions[] = [];
    expect(
      controller.evaluate(
        context({
          contextWindow: 272_000,
          tokens: 244_800,
          compact: (value) => requests.push(value),
        }),
      ),
    ).toBe("triggered");
    expect(requests).toHaveLength(1);
  });

  it("does not let a stale callback release a newer request", () => {
    const requests: CompactOptions[] = [];
    const controller = createContextWindowPolicyController();
    const ctx = context({
      contextWindow: 272_000,
      tokens: 244_800,
      compact: (value) => requests.push(value),
    });

    expect(controller.evaluate(ctx)).toBe("triggered");
    controller.reset();
    expect(controller.evaluate(ctx)).toBe("triggered");
    complete(requests[0]);
    expect(controller.evaluate(ctx)).toBe("pending");
    complete(requests[1]);
    expect(controller.evaluate(ctx)).toBe("triggered");
  });
});

describe("extension registration", () => {
  it("evaluates settled runs and only idle model selections", () => {
    const state = harness();
    const requests: CompactOptions[] = [];
    installContextWindowPolicy(state.api);

    state.agentSettled(
      context({
        contextWindow: 272_000,
        tokens: 244_800,
        compact: (value) => requests.push(value),
      }),
    );
    expect(requests).toHaveLength(1);
    complete(requests[0]);

    state.modelSelect(
      context({
        contextWindow: 128_000,
        tokens: 115_200,
        idle: false,
        compact: (value) => requests.push(value),
      }),
    );
    expect(requests).toHaveLength(1);
    state.modelSelect(
      context({
        contextWindow: 128_000,
        tokens: 115_200,
        idle: true,
        compact: (value) => requests.push(value),
      }),
    );
    expect(requests).toHaveLength(2);
  });

  it("resets pending state for every session lifecycle boundary", () => {
    const state = harness();
    const requests: CompactOptions[] = [];
    installContextWindowPolicy(state.api);
    const ctx = context({
      contextWindow: 272_000,
      tokens: 244_800,
      compact: (value) => requests.push(value),
    });

    expect(state.resets).toHaveLength(3);
    state.agentSettled(ctx);
    for (const reset of state.resets) {
      reset();
      state.agentSettled(ctx);
    }
    expect(requests).toHaveLength(4);
  });
});
