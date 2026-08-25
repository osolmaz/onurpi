import type {
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  CompactionEntry,
  ContextEvent,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTINUATION_MESSAGE_KIND,
  CONTINUATION_PROMPT,
  installCodexCompaction,
  type CodexCompactionApi,
  type CodexCompactionContext,
  type CompactionStatus,
  type ForcedCompactionDisplayEvent,
} from "./codex-compaction.ts";
import {
  NATIVE_COMPACTION_KIND,
  NATIVE_COMPACTION_VERSION,
  type CodexModel,
  type NativeCompactionDetails,
  type ResponseItem,
} from "./native-checkpoint.ts";
import { compactionSse, makeToken, MODEL_KEY, TEST_SESSION_ID, userEntry } from "./test-fakes.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function codexModel(overrides: Partial<CodexModel> = {}): CodexModel {
  return {
    id: "gpt-test",
    name: "GPT Test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 16_384,
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
    ...overrides,
  };
}

function otherModel(): CodexCompactionContext["model"] {
  return { ...codexModel(), provider: "anthropic", api: "anthropic-messages" };
}

function nativeCompactionEntry(
  id: string,
  details: NativeCompactionDetails,
): CompactionEntry<NativeCompactionDetails> {
  return {
    type: "compaction",
    id,
    parentId: "user-1",
    timestamp: new Date().toISOString(),
    summary: "OpenAI Codex native compaction checkpoint (test).",
    firstKeptEntryId: "user-1",
    tokensBefore: 50_000,
    details,
  };
}

function validDetails(encrypted: string, key = MODEL_KEY): NativeCompactionDetails {
  return {
    kind: NATIVE_COMPACTION_KIND,
    version: NATIVE_COMPACTION_VERSION,
    modelKey: key,
    replacementHistory: [
      { role: "user", content: [{ type: "input_text", text: "earlier user fact" }] },
      { type: "compaction", id: "cmp_1", encrypted_content: encrypted },
    ],
  };
}

type CompactCall = {
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
};

type Handlers = {
  context: Parameters<CodexCompactionApi["onContext"]>[0];
  modelSelect: Parameters<CodexCompactionApi["onModelSelect"]>[0];
  beforeProviderHeaders: Parameters<CodexCompactionApi["onBeforeProviderHeaders"]>[0];
  beforeProviderRequest: Parameters<CodexCompactionApi["onBeforeProviderRequest"]>[0];
  sessionBeforeCompact: Parameters<CodexCompactionApi["onSessionBeforeCompact"]>[0];
  turnEnd: Parameters<CodexCompactionApi["onTurnEnd"]>[0];
  sessionCompact: Parameters<CodexCompactionApi["onSessionCompact"]>[0];
  agentSettled: Parameters<CodexCompactionApi["onAgentSettled"]>[0];
  sessionStart: () => void;
};

type HandlerKey = keyof Handlers;

type CheckpointParams = {
  input: ResponseItem[];
  basePayload?: Record<string, unknown>;
};

type HarnessOptions = {
  model?: CodexCompactionContext["model"];
  createCheckpoint?: (params: CheckpointParams) => Promise<{ details: NativeCompactionDetails }>;
  autoCompact?: boolean;
  apiKeyAndHeaders?: () => Promise<
    { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }
  >;
};

function harness(initialBranch: SessionEntry[] = [], options: HarnessOptions = {}) {
  const registered = new Map<string, unknown>();
  const api: CodexCompactionApi = {
    onSessionStart: (handler) => registered.set("session_start", handler),
    onSessionShutdown: (handler) => registered.set("session_shutdown", handler),
    onModelSelect: (handler) => registered.set("model_select", handler),
    onContext: (handler) => registered.set("context", handler),
    onBeforeProviderHeaders: (handler) => registered.set("before_provider_headers", handler),
    onBeforeProviderRequest: (handler) => registered.set("before_provider_request", handler),
    onSessionBeforeCompact: (handler) => registered.set("session_before_compact", handler),
    onTurnEnd: (handler) => registered.set("turn_end", handler),
    onSessionCompact: (handler) => registered.set("session_compact", handler),
    onAgentSettled: (handler) => registered.set("agent_settled", handler),
    appendEntry: (customType, data) => {
      statusEntries.push({ customType, data });
    },
    emitForcedCompactionDisplay: (event) => {
      forcedCompactionDisplayEvents.push(event);
    },
    sendMessage: (message, sendOptions) => {
      sentMessages.push({ message, options: sendOptions });
    },
    getAllTools: () => [],
    getActiveTools: () => [],
  };

  const statusEntries: { customType: string; data: CompactionStatus }[] = [];
  const sentMessages: {
    message: {
      customType: typeof CONTINUATION_MESSAGE_KIND;
      content: typeof CONTINUATION_PROMPT;
      display: false;
    };
    options: { deliverAs: "followUp"; triggerTurn: true };
  }[] = [];
  const forcedCompactionDisplayEvents: ForcedCompactionDisplayEvent[] = [];
  const notifications: string[] = [];
  const compactCalls: CompactCall[] = [];
  let branch: SessionEntry[] = initialBranch;
  let aborted = 0;
  let pendingMessages = false;
  let usageTokens: number | null = 40_000;

  const ctx: CodexCompactionContext = {
    model: options.model ?? codexModel(),
    mode: "tui",
    cwd: "/var/tmp/pi-codex-compaction-test",
    hasUI: true,
    ui: { notify: (message) => notifications.push(message) },
    abort: () => {
      aborted += 1;
    },
    compact: (compactOptions = {}) => {
      compactCalls.push(compactOptions as CompactCall);
    },
    isProjectTrusted: () => false,
    hasPendingMessages: () => pendingMessages,
    getContextUsage: () => ({
      tokens: usageTokens,
      contextWindow: 200_000,
      percent: usageTokens === null ? null : (usageTokens / 200_000) * 100,
    }),
    getSystemPrompt: () => "You are Codex.",
    sessionManager: {
      getSessionId: () => TEST_SESSION_ID,
      getBranch: () => branch,
    },
    modelRegistry: {
      getApiKeyAndHeaders:
        options.apiKeyAndHeaders ??
        (() => Promise.resolve({ ok: true as const, apiKey: makeToken(), headers: {} })),
    },
  };

  const autoCompact = options.autoCompact ?? true;
  installCodexCompaction(
    api,
    options.createCheckpoint
      ? {
          createCheckpoint: options.createCheckpoint as never,
          readConfig: () => ({ autoCompact, thresholdRatio: 0.9 }),
        }
      : { readConfig: () => ({ autoCompact, thresholdRatio: 0.9 }) },
  );

  function handler<K extends HandlerKey>(name: string, key: K): Handlers[K] {
    const found = registered.get(name);
    if (!found) throw new Error(`Handler ${name} (${key}) was not registered`);
    return found as Handlers[K];
  }

  return {
    ctx,
    statusEntries,
    sentMessages,
    forcedCompactionDisplayEvents,
    notifications,
    compactCalls,
    setBranch: (next: SessionEntry[]) => {
      branch = next;
    },
    setPendingMessages: (value: boolean) => {
      pendingMessages = value;
    },
    setUsageTokens: (value: number | null) => {
      usageTokens = value;
    },
    abortCount: () => aborted,
    handlers: {
      context: () => handler("context", "context"),
      beforeProviderHeaders: () => handler("before_provider_headers", "beforeProviderHeaders"),
      beforeProviderRequest: () => handler("before_provider_request", "beforeProviderRequest"),
      sessionBeforeCompact: () => handler("session_before_compact", "sessionBeforeCompact"),
      turnEnd: () => handler("turn_end", "turnEnd"),
      sessionCompact: () => handler("session_compact", "sessionCompact"),
      agentSettled: () => handler("agent_settled", "agentSettled"),
      sessionStart: () => handler("session_start", "sessionStart"),
      modelSelect: () => handler("model_select", "modelSelect"),
    },
  };
}

function beforeCompactEvent(
  branch: SessionEntry[],
  overrides: Partial<SessionBeforeCompactEvent> = {},
): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    branchEntries: branch,
    preparation: {
      firstKeptEntryId: "user-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 50_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    },
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("session_before_compact", () => {
  it("creates a native checkpoint and stores it in Pi's compaction result", async () => {
    const requests: { input: ResponseItem[] }[] = [];
    const h = harness([userEntry("user-1", "Remember BLUE-42.")], {
      createCheckpoint: (params) => {
        requests.push(params);
        return Promise.resolve({ details: validDetails("opaque-state") });
      },
    });

    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "Remember BLUE-42.")]),
      h.ctx,
    );

    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction?.summary).toContain("OpenAI Codex native compaction checkpoint");
    expect(result?.compaction?.firstKeptEntryId).toBe("user-1");
    expect(result?.compaction?.details).toEqual(validDetails("opaque-state"));
    expect(requests).toHaveLength(1);
    expect(h.statusEntries.map((entry) => entry.data.state)).toEqual(["running", "complete"]);
  });

  it("sends credentials only to the validated official Codex endpoint", async () => {
    const seen: { url: unknown; authorization: string | null; feature: string | null }[] = [];
    globalThis.fetch = ((url: unknown, init?: RequestInit) => {
      seen.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
        feature: new Headers(init?.headers).get("x-codex-beta-features"),
      });
      return Promise.resolve(compactionSse("opaque-state"));
    }) as typeof fetch;

    const h = harness([userEntry("user-1", "Remember BLUE-42.")]);
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "Remember BLUE-42.")]),
      h.ctx,
    );

    expect(result?.compaction?.details?.kind).toBe(NATIVE_COMPACTION_KIND);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(seen[0]?.authorization).toBe(`Bearer ${makeToken()}`);
    expect(seen[0]?.feature).toContain("remote_compaction_v2");
  });

  it("never sends credentials to a custom model base URL", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(compactionSse());
    }) as typeof fetch;

    const h = harness([userEntry("user-1", "hello")], {
      model: codexModel({ baseUrl: "https://proxy.example.test" }),
    });
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );

    expect(called).toBe(false);
    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain("non-official endpoint");
    expect(h.notifications.join("\n")).not.toContain(makeToken());
    expect(h.statusEntries.map((entry) => entry.data.state)).toEqual(["running", "failed"]);
    expect(JSON.stringify(h.statusEntries)).not.toContain(makeToken());
  });

  it("cancels Pi compaction instead of falling back to text summarization", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("bad request", { status: 400 }))) as typeof fetch;
    const h = harness([userEntry("user-1", "hello")]);
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")], { reason: "threshold" }),
      h.ctx,
    );

    expect(result).toEqual({ cancel: true });
    expect(h.notifications[0]).toContain("native compaction failed");
    expect(h.statusEntries.map((entry) => entry.data.state)).toEqual(["running", "failed"]);
  });

  it("retries a message-less stream error once and then succeeds", async () => {
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve(
          new Response(`data: ${JSON.stringify({ type: "error" })}\n\n`, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      return Promise.resolve(compactionSse("retried-opaque"));
    }) as typeof fetch;
    const h = harness([userEntry("user-1", "continue after a transient failure")]);
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "continue after a transient failure")]),
      h.ctx,
    );

    expect(attempts).toBe(2);
    expect(result?.compaction?.details?.replacementHistory.at(-1)).toEqual({
      type: "compaction",
      id: "cmp_1",
      encrypted_content: "retried-opaque",
    });
  });

  it("does not retry an explicit stream error", async () => {
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts += 1;
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({ type: "error", message: "explicit failure" })}\n\n`,
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    }) as typeof fetch;
    const h = harness([userEntry("user-1", "do not retry")]);
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "do not retry")]),
      h.ctx,
    );

    expect(attempts).toBe(1);
    expect(result).toEqual({ cancel: true });
    expect(h.notifications).toContain("OpenAI Codex native compaction failed: explicit failure");
  });

  it("cancels silently when the compaction signal is already aborted", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("bad request", { status: 400 }))) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    const h = harness([userEntry("user-1", "hello")]);
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")], { signal: controller.signal }),
      h.ctx,
    );

    expect(result).toEqual({ cancel: true });
    expect(h.notifications).toEqual([]);
  });
});

describe("before_provider_request", () => {
  it("rebuilds input from the checkpoint and never replays the local marker", async () => {
    const firstUser = userEntry("user-1", "Remember BLUE-42.");
    const h = harness([firstUser], {
      createCheckpoint: () => Promise.resolve({ details: validDetails("opaque-state") }),
    });
    const result = await h.handlers.sessionBeforeCompact()(beforeCompactEvent([firstUser]), h.ctx);
    const summary = result?.compaction?.summary ?? "";
    expect(summary).toContain("checkpoint");

    const entry = nativeCompactionEntry("compact-1", validDetails("opaque-state"));
    const nextUser = { ...userEntry("user-2", "What was the code?"), parentId: "compact-1" };
    h.setBranch([firstUser, entry, nextUser]);

    const patched = (await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: {
          model: "gpt-test",
          input: [{ role: "user", content: [{ type: "input_text", text: summary }] }],
        },
      } satisfies BeforeProviderRequestEvent,
      h.ctx,
    )) as { input: ResponseItem[] };

    const serialized = JSON.stringify(patched);
    expect(serialized).not.toContain(summary);
    expect(patched.input[0]).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "earlier user fact" }],
    });
    expect(patched.input[1]).toEqual({
      type: "compaction",
      id: "cmp_1",
      encrypted_content: "opaque-state",
    });
    expect(patched.input[2]).toMatchObject({ role: "user" });
  });

  it("aborts rather than sending from a malformed checkpoint", async () => {
    const malformed = nativeCompactionEntry("compact-1", {
      kind: NATIVE_COMPACTION_KIND,
      version: NATIVE_COMPACTION_VERSION,
      modelKey: MODEL_KEY,
      replacementHistory: [],
    });
    const h = harness([userEntry("user-1", "hello")]);
    h.setBranch([userEntry("user-1", "hello"), malformed]);

    const patched = (await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: { model: "gpt-test", input: [{ role: "user", content: "local marker" }] },
      },
      h.ctx,
    )) as { input: unknown[] };

    expect(h.abortCount()).toBe(1);
    expect(patched.input).toEqual([]);
    expect(JSON.stringify(patched)).not.toContain("local marker");
  });

  it("aborts rather than sending from a model-mismatched checkpoint", async () => {
    const mismatched = nativeCompactionEntry(
      "compact-1",
      validDetails("opaque", "openai-codex:openai-codex-responses:other-model"),
    );
    const h = harness([userEntry("user-1", "hello")]);
    h.setBranch([userEntry("user-1", "hello"), mismatched]);

    const patched = (await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: { model: "gpt-test", input: [{ role: "user", content: "local marker" }] },
      },
      h.ctx,
    )) as { input: unknown[] };

    expect(h.abortCount()).toBe(1);
    expect(patched.input).toEqual([]);
    expect(h.notifications.join("\n")).toContain("different model");
  });
});

describe("context and headers", () => {
  it("filters the compaction summary from LLM context once a checkpoint exists", () => {
    const entry = nativeCompactionEntry("compact-1", validDetails("opaque-state"));
    const h = harness([userEntry("user-1", "hello")]);
    h.setBranch([userEntry("user-1", "hello"), entry]);

    const filtered = h.handlers.context()(
      {
        type: "context",
        messages: [
          { role: "compactionSummary", summary: "marker", tokens: 10 },
          { role: "user", content: [{ type: "text", text: "What was the code?" }], timestamp: 1 },
        ],
      } as ContextEvent,
      h.ctx,
    );

    expect(filtered?.messages).toHaveLength(1);
    expect(filtered?.messages?.[0]?.role).toBe("user");
  });

  it("passes context through unchanged when no checkpoint exists", () => {
    const h = harness([userEntry("user-1", "hello")]);
    const event = {
      type: "context",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
    } as ContextEvent;
    expect(h.handlers.context()(event, h.ctx)).toBeUndefined();
  });

  it("adds the beta feature header for Codex models only", () => {
    const h = harness([]);
    const headers: BeforeProviderHeadersEvent["headers"] = { "x-existing": "1" };
    h.handlers.beforeProviderHeaders()({ type: "before_provider_headers", headers }, h.ctx);
    expect(headers["x-codex-beta-features"]).toBe("remote_compaction_v2");

    const other = harness([], { model: otherModel() });
    const otherHeaders: BeforeProviderHeadersEvent["headers"] = {};
    other.handlers.beforeProviderHeaders()(
      { type: "before_provider_headers", headers: otherHeaders },
      other.ctx,
    );
    expect(otherHeaders["x-codex-beta-features"]).toBeUndefined();
  });
});

describe("credential and endpoint failures", () => {
  it("fails closed when Codex auth resolution fails", async () => {
    const h = harness([userEntry("user-1", "hello")], {
      apiKeyAndHeaders: () => Promise.resolve({ ok: false as const, error: "no Codex login" }),
    });
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );
    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain("no Codex login");
  });

  it("fails closed when no API key is available", async () => {
    const h = harness([userEntry("user-1", "hello")], {
      apiKeyAndHeaders: () => Promise.resolve({ ok: true as const }),
    });
    const result = await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );
    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain("authentication is unavailable");
  });

  it("reuses the cached payload shape for the compaction request", async () => {
    const seen: CheckpointParams[] = [];
    const h = harness([userEntry("user-1", "hello")], {
      createCheckpoint: (params) => {
        seen.push(params);
        return Promise.resolve({ details: validDetails("opaque-state") });
      },
    });

    const passthrough = await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: { model: "gpt-test", input: [1], messages: [2], reasoning: { effort: "high" } },
      },
      h.ctx,
    );
    expect(passthrough).toBeUndefined();

    await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );
    expect(seen[0]?.basePayload).toEqual({ model: "gpt-test", reasoning: { effort: "high" } });
  });

  it("ignores non-JSON provider payloads", async () => {
    const h = harness([userEntry("user-1", "hello")]);
    const result = await h.handlers.beforeProviderRequest()(
      { type: "before_provider_request", payload: "raw-string" },
      h.ctx,
    );
    expect(result).toBeUndefined();
  });
});

describe("forced mid-run compaction", () => {
  function settledCompactionEvent(): SessionCompactEvent {
    return {
      type: "session_compact",
      compactionEntry: nativeCompactionEntry("compact-1", validDetails("opaque-state")),
      fromExtension: true,
      reason: "threshold",
      willRetry: false,
    };
  }

  function expectedContinuation() {
    return [
      {
        message: {
          customType: CONTINUATION_MESSAGE_KIND,
          content: CONTINUATION_PROMPT,
          display: false,
        },
        options: { deliverAs: "followUp", triggerTurn: true },
      },
    ];
  }

  function expectedHoldAndRelease(): ForcedCompactionDisplayEvent[] {
    return [
      { action: "hold", sessionId: TEST_SESSION_ID },
      { action: "release", sessionId: TEST_SESSION_ID },
    ];
  }

  it("aborts at 90 percent, compacts after settlement, and continues without a visible row", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);

    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(1);
    expect(h.compactCalls).toHaveLength(0);
    expect(h.forcedCompactionDisplayEvents).toEqual([
      { action: "hold", sessionId: TEST_SESSION_ID },
    ]);

    h.handlers.agentSettled()(h.ctx);
    expect(h.compactCalls).toHaveLength(1);
    h.compactCalls[0]?.onComplete?.({});

    expect(h.sentMessages).toEqual(expectedContinuation());
  });

  it("aborts only once while a forced compaction is pending", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);

    h.handlers.turnEnd()(h.ctx);
    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(1);

    h.handlers.agentSettled()(h.ctx);
    h.handlers.agentSettled()(h.ctx);
    expect(h.compactCalls).toHaveLength(1);
  });

  it("uses Pi threshold compaction when it finishes before settlement", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);

    h.handlers.sessionCompact()(settledCompactionEvent(), h.ctx);
    h.handlers.agentSettled()(h.ctx);

    expect(h.compactCalls).toHaveLength(0);
    expect(h.sentMessages).toEqual(expectedContinuation());
  });

  it("does not add a continuation when overflow recovery will retry", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);

    h.handlers.sessionCompact()(
      { ...settledCompactionEvent(), reason: "overflow", willRetry: true },
      h.ctx,
    );
    h.handlers.agentSettled()(h.ctx);

    expect(h.compactCalls).toHaveLength(0);
    expect(h.sentMessages).toEqual([]);
  });

  it("does not interrupt below the configured threshold", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(179_999);
    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(0);
    expect(h.forcedCompactionDisplayEvents).toEqual([]);
  });

  it("releases the display hold when input is already queued", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);
    h.handlers.agentSettled()(h.ctx);
    h.setPendingMessages(true);
    h.compactCalls[0]?.onComplete?.({});

    expect(h.sentMessages).toEqual([]);
    expect(h.forcedCompactionDisplayEvents).toEqual(expectedHoldAndRelease());
  });

  it("releases the display hold when the forced compaction fails", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);
    h.handlers.agentSettled()(h.ctx);
    h.compactCalls[0]?.onError?.(new Error("remote down"));

    expect(h.sentMessages).toEqual([]);
    expect(h.forcedCompactionDisplayEvents).toEqual(expectedHoldAndRelease());
    expect(h.notifications.join("\n")).toContain("compaction failed");
  });

  it("leaves non-Codex providers untouched", async () => {
    const h = harness([userEntry("user-1", "hello")], { model: otherModel() });
    h.setUsageTokens(199_999);

    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(0);
    h.handlers.agentSettled()(h.ctx);
    expect(h.compactCalls).toHaveLength(0);

    expect(
      await h.handlers.sessionBeforeCompact()(
        beforeCompactEvent([userEntry("user-1", "hello")]),
        h.ctx,
      ),
    ).toBeUndefined();
    expect(
      await h.handlers.beforeProviderRequest()(
        { type: "before_provider_request", payload: { input: ["original"] } },
        h.ctx,
      ),
    ).toBeUndefined();
  });

  it("resets forced state when the session restarts", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(1);

    h.handlers.sessionStart()();
    h.handlers.agentSettled()(h.ctx);
    expect(h.compactCalls).toHaveLength(0);
  });

  it("respects autoCompact being disabled", () => {
    const h = harness([userEntry("user-1", "continue the task")], { autoCompact: false });
    h.setUsageTokens(199_999);
    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(0);
  });

  it("passes through when context usage is unknown", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(null);
    h.handlers.turnEnd()(h.ctx);
    expect(h.abortCount()).toBe(0);
  });

  it("releases the display hold when the model changes", () => {
    const h = harness([userEntry("user-1", "continue the task")]);
    h.setUsageTokens(180_000);
    h.handlers.turnEnd()(h.ctx);
    h.handlers.modelSelect()(h.ctx);
    h.handlers.agentSettled()(h.ctx);

    expect(h.compactCalls).toHaveLength(0);
    expect(h.forcedCompactionDisplayEvents).toEqual(expectedHoldAndRelease());
  });
});

describe("provider headers", () => {
  it("merges into a case-insensitively matched existing feature header", () => {
    const h = harness([]);
    const headers: BeforeProviderHeadersEvent["headers"] = { "X-Codex-Beta-Features": "other" };
    h.handlers.beforeProviderHeaders()({ type: "before_provider_headers", headers }, h.ctx);
    expect(headers["X-Codex-Beta-Features"]).toBe("other,remote_compaction_v2");
    expect(headers["x-codex-beta-features"]).toBeUndefined();
  });
});
