import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  createSessionBeforeCompactHandler,
  expectedSummaryCalls,
  installReliableCompaction,
  policyForModel,
  type ReliableCompactionApi,
  type SessionBeforeCompactHandler,
  withCompactionPolicy,
} from "./reliable-compaction.ts";

type HookEvent = Parameters<SessionBeforeCompactHandler>[0];
type HookContext = Parameters<SessionBeforeCompactHandler>[1];

function model(api: Api = "openai-codex-responses"): Model<Api> {
  return {
    id: "test-model",
    name: "Test model",
    api,
    provider: "openai-codex",
    baseUrl: "https://proxy.example.test",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 16_384,
  };
}

function event(options: { split?: boolean; history?: boolean } = {}): HookEvent {
  return {
    preparation: {
      firstKeptEntryId: "kept-entry",
      messagesToSummarize: options.history
        ? [{ role: "user", content: "history", timestamp: 1 }]
        : [],
      turnPrefixMessages: options.split ? [{ role: "user", content: "prefix", timestamp: 2 }] : [],
      isSplitTurn: options.split ?? false,
      tokensBefore: 250_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    },
  };
}

function assistant(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "summary" }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1,
  };
}

function harness(): {
  pi: ReliableCompactionApi;
  registered: () => ProviderConfig | undefined;
  unregistered: string[];
  handler: () => SessionBeforeCompactHandler | undefined;
} {
  let config: ProviderConfig | undefined;
  let handler: SessionBeforeCompactHandler | undefined;
  const unregistered: string[] = [];
  return {
    pi: {
      onSessionBeforeCompact: (value) => {
        handler = value;
      },
      registerProvider: (_name, value) => {
        config = value;
      },
      unregisterProvider: (name) => {
        unregistered.push(name);
        config = undefined;
      },
    },
    registered: () => config,
    unregistered,
    handler: () => handler,
  };
}

function context(
  selectedModel: Model<Api> | undefined = model(),
  registered?: unknown,
  registeredReader?: () => unknown,
): HookContext {
  return {
    model: selectedModel,
    modelRegistry: {
      getRegisteredProviderConfig: () =>
        registeredReader === undefined ? registered : registeredReader(),
    },
  };
}

function requireStream(
  config: ProviderConfig | undefined,
): NonNullable<ProviderConfig["streamSimple"]> {
  expect(config?.streamSimple).toBeTypeOf("function");
  if (!config?.streamSimple) throw new Error("Expected a provider stream override");
  return config.streamSimple;
}

describe("reliable compaction policy", () => {
  it("selects SSE with one retry for Codex Responses models", () => {
    expect(policyForModel(model())).toEqual({ maxAttempts: 2, transport: "sse" });
  });

  it("passes through models without a reliability policy", () => {
    expect(policyForModel(model("anthropic-messages"))).toBeUndefined();
  });

  it("counts one or two summary calls from Pi's public preparation", () => {
    expect(expectedSummaryCalls(event())).toBe(1);
    expect(expectedSummaryCalls(event({ split: true }))).toBe(1);
    expect(expectedSummaryCalls(event({ split: true, history: true }))).toBe(2);
  });
});

describe("provider stream policy", () => {
  it("forces SSE and one retry while preserving Pi's prepared request options", async () => {
    let observed: SimpleStreamOptions | undefined;
    const source = createAssistantMessageEventStream();
    const failures: boolean[] = [];
    const stream = withCompactionPolicy(
      (_model, _context, options) => {
        observed = options;
        return source;
      },
      { maxAttempts: 2, transport: "sse" },
      (failed) => failures.push(failed),
    );

    const returned = stream(
      model(),
      { messages: [] },
      {
        apiKey: "token",
        headers: { trace: "kept" },
        maxTokens: 4_096,
        maxRetries: 9,
        timeoutMs: 123,
        transport: "websocket",
      },
    );
    expect(returned).toBe(source);
    expect(observed).toMatchObject({
      apiKey: "token",
      headers: { trace: "kept" },
      maxTokens: 4_096,
      maxRetries: 1,
      timeoutMs: 123,
      transport: "sse",
    });

    source.end(assistant());
    await source.result();
    await Promise.resolve();
    expect(failures).toEqual([false]);
  });

  it("reports failed and aborted streams", async () => {
    for (const reason of ["error", "aborted"] as const) {
      const source = createAssistantMessageEventStream();
      const failures: boolean[] = [];
      const stream = withCompactionPolicy(
        () => source,
        { maxAttempts: 2, transport: "sse" },
        (failed) => failures.push(failed),
      );
      stream(model(), { messages: [] });
      source.end(assistant(reason));
      await source.result();
      await Promise.resolve();
      expect(failures).toEqual([true]);
    }
  });

  it("releases the override when the provider throws synchronously", () => {
    const failures: boolean[] = [];
    const stream = withCompactionPolicy(
      () => {
        throw new Error("offline");
      },
      { maxAttempts: 2, transport: "sse" },
      (failed) => failures.push(failed),
    );

    expect(() => stream(model(), { messages: [] })).toThrow("offline");
    expect(failures).toEqual([true]);
  });
});

describe("session_before_compact handler", () => {
  it("passes through without a selected model or policy", () => {
    const state = harness();
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => createAssistantMessageEventStream(),
    });

    const noModel = context();
    noModel.model = undefined;
    expect(handler(event(), noModel)).toBeUndefined();
    expect(handler(event(), context(model("anthropic-messages")))).toBeUndefined();
    expect(state.registered()).toBeUndefined();
  });

  it("does not replace another extension's provider stream", () => {
    const state = harness();
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => createAssistantMessageEventStream(),
    });

    expect(handler(event(), context(model(), { streamSimple: "custom" }))).toBeUndefined();
    expect(state.registered()).toBeUndefined();
  });

  it("registers a temporary provider override and lets Pi compact normally", async () => {
    const state = harness();
    const source = createAssistantMessageEventStream();
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => source,
    });

    expect(handler(event(), context())).toBeUndefined();
    const config = state.registered();
    expect(config?.api).toBe("openai-codex-responses");
    requireStream(config)(model(), { messages: [] });
    source.end(assistant());
    await source.result();
    await Promise.resolve();
    expect(state.unregistered).toEqual(["openai-codex"]);
  });

  it("keeps the override for both parts of a split-turn summary", async () => {
    const state = harness();
    const sources = [createAssistantMessageEventStream(), createAssistantMessageEventStream()];
    let call = 0;
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => {
        const source = sources[call];
        call += 1;
        if (!source) throw new Error("Unexpected summary call");
        return source;
      },
    });

    await handler(event({ split: true, history: true }), context());
    const stream = requireStream(state.registered());
    stream(model(), { messages: [] });
    sources[0]?.end(assistant());
    await sources[0]?.result();
    await Promise.resolve();
    expect(state.unregistered).toEqual([]);

    stream(model(), { messages: [] });
    sources[1]?.end(assistant());
    await sources[1]?.result();
    await Promise.resolve();
    expect(state.unregistered).toEqual(["openai-codex"]);
  });

  it("removes a split-turn override immediately after failure", async () => {
    const state = harness();
    const source = createAssistantMessageEventStream();
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => source,
    });

    await handler(event({ split: true, history: true }), context());
    requireStream(state.registered())(model(), { messages: [] });
    source.end(assistant("error"));
    await source.result();
    await Promise.resolve();
    expect(state.unregistered).toEqual(["openai-codex"]);
  });

  it("does not unregister a provider that replaced its temporary override", async () => {
    const state = harness();
    const source = createAssistantMessageEventStream();
    const registryState: { current?: unknown } = {};
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => source,
    });

    await handler(
      event(),
      context(model(), undefined, () => registryState.current),
    );
    registryState.current = { streamSimple: "replacement" };
    requireStream(state.registered())(model(), { messages: [] });
    source.end(assistant());
    await source.result();
    await Promise.resolve();
    expect(state.unregistered).toEqual([]);
  });

  it("restores an unfinished override before arming another one", async () => {
    const state = harness();
    const handler = createSessionBeforeCompactHandler(state.pi, {
      streamSimple: () => createAssistantMessageEventStream(),
    });

    await handler(event(), context());
    await handler(event(), context());
    expect(state.unregistered).toEqual(["openai-codex"]);
    expect(state.registered()).toBeDefined();
  });
});

describe("extension registration", () => {
  it("registers one compaction handler", () => {
    const state = harness();
    installReliableCompaction(state.pi, {
      streamSimple: () => createAssistantMessageEventStream(),
    });
    expect(state.handler()).toBeTypeOf("function");
  });
});
