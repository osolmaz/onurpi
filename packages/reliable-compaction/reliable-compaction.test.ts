import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ApiStreamSimpleFunction } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";

import {
  type CompactionFunction,
  createSessionBeforeCompactHandler,
  forceTransport,
  installReliableCompaction,
  policyForModel,
  type ReliableCompactionDependencies,
  type ReliableCompactionOutcome,
  runReliableCompaction,
  type SessionBeforeCompactHandler,
} from "./reliable-compaction.ts";

type Preparation = Parameters<CompactionFunction>[0];
type HookEvent = Parameters<SessionBeforeCompactHandler>[0];
type HookContext = Parameters<SessionBeforeCompactHandler>[1];
type AuthResult = Awaited<ReturnType<HookContext["modelRegistry"]["getApiKeyAndHeaders"]>>;

const COMPACTION = {
  summary: "summary",
  firstKeptEntryId: "kept-entry",
  tokensBefore: 250_000,
  details: { readFiles: [], modifiedFiles: [] },
};

function model(api: Api = "openai-codex-responses"): Model<Api> {
  return {
    id: "test-model",
    name: "Test model",
    api,
    provider: "openai-codex",
    baseUrl: "https://example.test",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 16_384,
  };
}

function preparation(): Preparation {
  return {
    firstKeptEntryId: "kept-entry",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 250_000,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
}

function event(controller = new AbortController()): HookEvent {
  return {
    preparation: preparation(),
    customInstructions: "Keep exact paths",
    signal: controller.signal,
  };
}

function unusedStream(): ApiStreamSimpleFunction {
  return () => {
    throw new Error("The compact test double should not call the stream");
  };
}

function dependencies(compact: CompactionFunction): ReliableCompactionDependencies {
  return { compact, streamSimple: unusedStream() };
}

function context(
  selectedModel: Model<Api> | undefined = model(),
  auth: AuthResult = { ok: true, apiKey: "token", headers: { test: "header" } },
): { ctx: HookContext; notifications: string[] } {
  const notifications: string[] = [];
  return {
    ctx: {
      model: selectedModel,
      modelRegistry: { getApiKeyAndHeaders: () => Promise.resolve(auth) },
      hasUI: true,
      ui: {
        notify: (message) => {
          notifications.push(message);
        },
      },
    },
    notifications,
  };
}

function successfulCompact(): CompactionFunction {
  return () => Promise.resolve(COMPACTION);
}

function expectFailure(
  outcome: ReliableCompactionOutcome,
): asserts outcome is Extract<ReliableCompactionOutcome, { kind: "failure" }> {
  expect(outcome.kind).toBe("failure");
  if (outcome.kind !== "failure") throw new Error("Expected compaction failure");
}

describe("reliable compaction transport policy", () => {
  it("selects SSE with two attempts for Codex Responses models", () => {
    expect(policyForModel(model())).toEqual({ maxAttempts: 2, transport: "sse" });
  });

  it("passes through models without a reliability policy", () => {
    expect(policyForModel(model("anthropic-messages"))).toBeUndefined();
  });

  it("overrides an existing transport while preserving other stream options", () => {
    let observed: SimpleStreamOptions | undefined;
    const base: ApiStreamSimpleFunction = (_model, _context, options) => {
      observed = options;
      throw new Error("observed");
    };
    const stream = forceTransport(base, "sse");

    expect(() =>
      stream(model(), { messages: [] }, { maxTokens: 4_096, transport: "websocket" }),
    ).toThrow("observed");
    expect(observed).toMatchObject({ maxTokens: 4_096, transport: "sse" });
  });
});

describe("runReliableCompaction", () => {
  it("forwards preparation, auth, instructions, signal, thinking, and environment", async () => {
    const calls: Parameters<CompactionFunction>[] = [];
    const compact: CompactionFunction = (...arguments_) => {
      calls.push(arguments_);
      return Promise.resolve(COMPACTION);
    };
    const controller = new AbortController();
    const requestEvent = event(controller);
    const selectedModel = model();
    const outcome = await runReliableCompaction(
      {
        auth: {
          ok: true,
          apiKey: "token",
          headers: { header: "value" },
          env: { HTTPS_PROXY: "proxy" },
        },
        event: requestEvent,
        model: selectedModel,
        thinkingLevel: "high",
      },
      { maxAttempts: 2, transport: "sse" },
      dependencies(compact),
    );

    expect(outcome).toEqual({ kind: "compaction", compaction: COMPACTION, attempts: 1 });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected one compaction call");
    expect(call[0]).toBe(requestEvent.preparation);
    expect(call[1]).toBe(selectedModel);
    expect(call[2]).toBe("token");
    expect(call[3]).toEqual({ header: "value" });
    expect(call[4]).toBe("Keep exact paths");
    expect(call[5]).toBe(controller.signal);
    expect(call[6]).toBe("high");
    expect(call[7]).toBeTypeOf("function");
    expect(call[8]).toEqual({ HTTPS_PROXY: "proxy" });
  });

  it("retries one uncommitted failure", async () => {
    let attempts = 0;
    const compact: CompactionFunction = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection reset");
      return Promise.resolve(COMPACTION);
    };

    const outcome = await runReliableCompaction(
      {
        auth: { ok: true, apiKey: "token" },
        event: event(),
        model: model(),
        thinkingLevel: "low",
      },
      { maxAttempts: 2, transport: "sse" },
      dependencies(compact),
    );

    expect(outcome).toEqual({ kind: "compaction", compaction: COMPACTION, attempts: 2 });
    expect(attempts).toBe(2);
  });

  it("does not start after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;
    const compact: CompactionFunction = () => {
      attempts += 1;
      return Promise.resolve(COMPACTION);
    };

    const outcome = await runReliableCompaction(
      {
        auth: { ok: true, apiKey: "token" },
        event: event(controller),
        model: model(),
        thinkingLevel: "low",
      },
      { maxAttempts: 2, transport: "sse" },
      dependencies(compact),
    );

    expectFailure(outcome);
    expect(outcome.aborted).toBe(true);
    expect(outcome.attempts).toBe(0);
    expect(attempts).toBe(0);
  });

  it("does not retry cancellation", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const compact: CompactionFunction = () => {
      attempts += 1;
      controller.abort();
      throw new DOMException("Cancelled", "AbortError");
    };

    const outcome = await runReliableCompaction(
      {
        auth: { ok: true, apiKey: "token" },
        event: event(controller),
        model: model(),
        thinkingLevel: "low",
      },
      { maxAttempts: 2, transport: "sse" },
      dependencies(compact),
    );

    expectFailure(outcome);
    expect(outcome.aborted).toBe(true);
    expect(outcome.attempts).toBe(1);
    expect(attempts).toBe(1);
  });

  it("returns the final error after the bounded attempts", async () => {
    let attempts = 0;
    const compact: CompactionFunction = () => {
      attempts += 1;
      throw new Error(`failure ${String(attempts)}`);
    };

    const outcome = await runReliableCompaction(
      {
        auth: { ok: true, apiKey: "token" },
        event: event(),
        model: model(),
        thinkingLevel: "low",
      },
      { maxAttempts: 2, transport: "sse" },
      dependencies(compact),
    );

    expectFailure(outcome);
    expect(outcome.aborted).toBe(false);
    expect(outcome.attempts).toBe(2);
    expect(outcome.error.message).toBe("failure 2");
  });
});

describe("session_before_compact handler", () => {
  it("passes through when there is no selected model", async () => {
    const handler = createSessionBeforeCompactHandler(
      dependencies(successfulCompact()),
      () => "high",
    );
    const { ctx } = context();
    ctx.model = undefined;

    await expect(handler(event(), ctx)).resolves.toBeUndefined();
  });

  it("passes through providers without a policy", async () => {
    const handler = createSessionBeforeCompactHandler(
      dependencies(successfulCompact()),
      () => "high",
    );
    const { ctx } = context(model("anthropic-messages"));

    await expect(handler(event(), ctx)).resolves.toBeUndefined();
  });

  it("returns the extension compaction for an affected model", async () => {
    const handler = createSessionBeforeCompactHandler(
      dependencies(successfulCompact()),
      () => "high",
    );
    const { ctx, notifications } = context();

    await expect(handler(event(), ctx)).resolves.toEqual({ compaction: COMPACTION });
    expect(notifications).toEqual([]);
  });

  it("cancels instead of falling back when authentication fails", async () => {
    const handler = createSessionBeforeCompactHandler(
      dependencies(successfulCompact()),
      () => "high",
    );
    const { ctx, notifications } = context(model(), { ok: false, error: "expired" });

    await expect(handler(event(), ctx)).resolves.toEqual({ cancel: true });
    expect(notifications).toEqual(["Reliable compaction authentication failed: expired"]);
  });

  it("cancels when resolved authentication has no credentials", async () => {
    const handler = createSessionBeforeCompactHandler(
      dependencies(successfulCompact()),
      () => "high",
    );
    const { ctx, notifications } = context(model(), { ok: true });

    await expect(handler(event(), ctx)).resolves.toEqual({ cancel: true });
    expect(notifications[0]).toContain("has no credentials");
  });

  it("cancels without default fallback after both attempts fail", async () => {
    const compact: CompactionFunction = () => {
      throw new Error("offline");
    };
    const handler = createSessionBeforeCompactHandler(dependencies(compact), () => "high");
    const { ctx, notifications } = context();

    await expect(handler(event(), ctx)).resolves.toEqual({ cancel: true });
    expect(notifications).toEqual(["Reliable compaction failed after 2 attempts: offline"]);
  });

  it("does not report user cancellation as an error", async () => {
    const controller = new AbortController();
    const compact: CompactionFunction = () => {
      controller.abort();
      throw new DOMException("Cancelled", "AbortError");
    };
    const handler = createSessionBeforeCompactHandler(dependencies(compact), () => "high");
    const { ctx, notifications } = context();

    await expect(handler(event(controller), ctx)).resolves.toEqual({ cancel: true });
    expect(notifications).toEqual([]);
  });
});

describe("extension registration", () => {
  it("registers one compaction handler with the current thinking level", async () => {
    let registered: SessionBeforeCompactHandler | undefined;
    installReliableCompaction(
      {
        getThinkingLevel: () => "medium",
        onSessionBeforeCompact: (handler) => {
          registered = handler;
        },
      },
      dependencies(successfulCompact()),
    );
    expect(registered).toBeDefined();
    if (!registered) throw new Error("Compaction handler was not registered");
    const { ctx } = context();

    await expect(registered(event(), ctx)).resolves.toEqual({ compaction: COMPACTION });
  });
});
