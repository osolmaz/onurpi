import type {
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  CompactionEntry,
  ContextEvent,
  SessionBeforeCompactEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  BRANCH_FENCE_ERROR,
  installCodexCompaction,
  type CodexCompactionApi,
  type CodexCompactionContext,
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

type Handlers = {
  context: Parameters<CodexCompactionApi["onContext"]>[0];
  modelSelect: Parameters<CodexCompactionApi["onModelSelect"]>[0];
  beforeProviderHeaders: Parameters<CodexCompactionApi["onBeforeProviderHeaders"]>[0];
  beforeProviderRequest: Parameters<CodexCompactionApi["onBeforeProviderRequest"]>[0];
  sessionBeforeCompact: Parameters<CodexCompactionApi["onSessionBeforeCompact"]>[0];
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
    getAllTools: () => [],
    getActiveTools: () => [],
  };

  const notifications: string[] = [];
  let branch: SessionEntry[] = initialBranch;
  let aborted = 0;

  const ctx: CodexCompactionContext = {
    model: options.model ?? codexModel(),
    hasUI: true,
    ui: { notify: (message) => notifications.push(message) },
    abort: () => {
      aborted += 1;
    },
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

  installCodexCompaction(
    api,
    options.createCheckpoint ? { createCheckpoint: options.createCheckpoint as never } : {},
  );

  function handler<K extends HandlerKey>(name: string, key: K): Handlers[K] {
    const found = registered.get(name);
    if (!found) throw new Error(`Handler ${name} (${key}) was not registered`);
    return found as Handlers[K];
  }

  return {
    ctx,
    registered,
    notifications,
    setBranch: (next: SessionEntry[]) => {
      branch = next;
    },
    abortCount: () => aborted,
    handlers: {
      context: () => handler("context", "context"),
      beforeProviderHeaders: () => handler("before_provider_headers", "beforeProviderHeaders"),
      beforeProviderRequest: () => handler("before_provider_request", "beforeProviderRequest"),
      sessionBeforeCompact: () => handler("session_before_compact", "sessionBeforeCompact"),
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
  });

  it.each(["manual", "threshold", "overflow"] as const)(
    "provides the native checkpoint for Pi-owned %s compaction",
    async (reason) => {
      const h = harness([userEntry("user-1", "Remember BLUE-42.")], {
        createCheckpoint: () => Promise.resolve({ details: validDetails("opaque-state") }),
      });

      const result = await h.handlers.sessionBeforeCompact()(
        beforeCompactEvent([userEntry("user-1", "Remember BLUE-42.")], {
          reason,
          willRetry: reason === "overflow",
        }),
        h.ctx,
      );

      expect(result?.cancel).toBeUndefined();
      expect(result?.compaction?.details?.kind).toBe(NATIVE_COMPACTION_KIND);
    },
  );

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

describe("branch snapshot fence", () => {
  function deferredCheckpoint() {
    let resolve!: (value: { details: NativeCompactionDetails }) => void;
    const promise = new Promise<{ details: NativeCompactionDetails }>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("accepts the checkpoint when the branch is unchanged after the remote call", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction?.details).toEqual(validDetails("opaque-state"));
  });

  it("discards the checkpoint when any custom entry appears during the remote call", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });
    const customEntry: SessionEntry = {
      type: "custom",
      id: "custom-1",
      parentId: "user-1",
      timestamp: new Date().toISOString(),
      customType: "other-extension-state",
      data: {},
    };

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    h.setBranch([...branch, customEntry]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("discards the checkpoint when a context message arrives during the remote call", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    // Interleaving: another context-bearing entry lands before the remote compaction returns.
    h.setBranch([...branch, { ...userEntry("user-2", "one more thing"), parentId: "user-1" }]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result).toEqual({ cancel: true });
    expect(result?.compaction).toBeUndefined();
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("discards the checkpoint when an assistant tool call lands during the remote call", async () => {
    const branch = [userEntry("user-1", "run the tool")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    const toolCall: SessionEntry = {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } },
        ],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-test",
        stopReason: "toolUse",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      },
    };
    h.setBranch([...branch, toolCall]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    // The checkpoint must not be spliced between the function call and its future result.
    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("discards the checkpoint when another compaction entry lands during the remote call", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    h.setBranch([...branch, nativeCompactionEntry("compact-1", validDetails("other"))]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("discards the checkpoint when the snapshot tip is no longer on the active branch", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent(branch), h.ctx);
    h.setBranch([userEntry("other-branch-tip", "different branch")]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("discards the checkpoint from an empty snapshot when a foreign entry appears", async () => {
    const checkpoint = deferredCheckpoint();
    const h = harness([], { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(beforeCompactEvent([]), h.ctx);
    h.setBranch([userEntry("user-1", "hi")]);
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

    expect(result).toEqual({ cancel: true });
    expect(h.notifications.join("\n")).toContain(BRANCH_FENCE_ERROR);
  });

  it("stays silent about a fenced checkpoint when the compaction signal is aborted", async () => {
    const branch = [userEntry("user-1", "Remember BLUE-42.")];
    const checkpoint = deferredCheckpoint();
    const controller = new AbortController();
    const h = harness(branch, { createCheckpoint: () => checkpoint.promise });

    const pending = h.handlers.sessionBeforeCompact()(
      beforeCompactEvent(branch, { signal: controller.signal }),
      h.ctx,
    );
    h.setBranch([...branch, { ...userEntry("user-2", "new"), parentId: "user-1" }]);
    controller.abort();
    checkpoint.resolve({ details: validDetails("opaque-state") });
    const result = await pending;

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

describe("lifecycle registration", () => {
  it("registers no forced turn-boundary lifecycle handlers", () => {
    const h = harness([]);
    expect(h.registered.has("turn_end")).toBe(false);
    expect(h.registered.has("agent_settled")).toBe(false);
    expect(h.registered.has("session_compact")).toBe(false);
    expect([...h.registered.keys()].sort()).toEqual([
      "before_provider_headers",
      "before_provider_request",
      "context",
      "model_select",
      "session_before_compact",
      "session_shutdown",
      "session_start",
    ]);
  });

  it("leaves non-Codex providers untouched", async () => {
    const h = harness([userEntry("user-1", "hello")], { model: otherModel() });

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

  it("drops the cached payload shape when the session restarts or the model changes", async () => {
    const seen: CheckpointParams[] = [];
    const h = harness([userEntry("user-1", "hello")], {
      createCheckpoint: (params) => {
        seen.push(params);
        return Promise.resolve({ details: validDetails("opaque-state") });
      },
    });

    await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: { model: "gpt-test", input: [], reasoning: { effort: "high" } },
      },
      h.ctx,
    );
    h.handlers.modelSelect()(h.ctx);
    await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );
    expect(seen[0]?.basePayload).toBeUndefined();

    await h.handlers.beforeProviderRequest()(
      {
        type: "before_provider_request",
        payload: { model: "gpt-test", input: [], reasoning: { effort: "low" } },
      },
      h.ctx,
    );
    h.handlers.sessionStart()();
    await h.handlers.sessionBeforeCompact()(
      beforeCompactEvent([userEntry("user-1", "hello")]),
      h.ctx,
    );
    expect(seen[1]?.basePayload).toBeUndefined();
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
