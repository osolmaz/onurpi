import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  CompactOptions,
  CompactionResult,
  SessionCompactEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  autoCompactTokenLimit,
  CONTINUATION_MESSAGE_KIND,
  CONTINUATION_PROMPT,
  createContextWindowPolicyController,
  isCodexNativeModel,
  type ContextWindowPolicyApi,
  type ContextWindowPolicyContext,
} from "./context-window-policy.ts";

const USAGE = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const COMPACTION_RESULT: CompactionResult = {
  estimatedTokensAfter: 20_000,
  firstKeptEntryId: "kept",
  summary: "summary",
  tokensBefore: 244_800,
};

function assistantMessage(
  stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
  return {
    api: "openai-codex-responses",
    content: [],
    model: "gpt-5.6-sol",
    provider: "openai-codex",
    role: "assistant",
    stopReason,
    timestamp: 1,
    usage: USAGE,
  };
}

function toolResult(): ToolResultMessage {
  return {
    content: [{ text: "done", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: 2,
    toolCallId: "tool-1",
    toolName: "read",
  };
}

function turnEvent(withTool = true): TurnEndEvent {
  return {
    message: assistantMessage(withTool ? "toolUse" : "stop"),
    toolResults: withTool ? [toolResult()] : [],
    turnIndex: 0,
    type: "turn_end",
  };
}

function compactEvent(willRetry = false): SessionCompactEvent {
  return {
    compactionEntry: {
      firstKeptEntryId: "kept",
      id: "compaction-1",
      parentId: "assistant-1",
      summary: "summary",
      timestamp: new Date(0).toISOString(),
      tokensBefore: 260_000,
      type: "compaction",
    },
    fromExtension: true,
    reason: "threshold",
    type: "session_compact",
    willRetry,
  };
}

type ContextOptions = {
  abort?: () => void;
  compact?: (options: CompactOptions) => void;
  contextWindow?: number;
  hasPendingMessages?: boolean;
  isIdle?: boolean;
  model?: "codex" | "custom" | "none";
  sessionId?: string;
  tokens?: number | null;
};

function context(options: ContextOptions = {}): ContextWindowPolicyContext {
  const contextWindow = options.contextWindow ?? 272_000;
  const modelKind = options.model ?? "codex";
  const model =
    modelKind === "none"
      ? undefined
      : {
          api: "openai-codex-responses" as const,
          baseUrl: "https://chatgpt.com/backend-api/codex",
          contextWindow,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "gpt-5.6-sol",
          input: ["text" as const],
          maxTokens: 128_000,
          name: "GPT-5.6 Sol",
          provider: modelKind === "codex" ? "openai-codex" : "custom-codex",
          reasoning: true,
        };
  return {
    abort: () => {
      options.abort?.();
    },
    compact: (compactOptions = {}) => {
      options.compact?.(compactOptions);
    },
    getContextUsage: () => {
      if (options.tokens === undefined) return undefined;
      return {
        contextWindow,
        percent: options.tokens === null ? null : (options.tokens / contextWindow) * 100,
        tokens: options.tokens,
      };
    },
    hasPendingMessages: () => options.hasPendingMessages ?? false,
    hasUI: true,
    isIdle: () => options.isIdle ?? true,
    model,
    sessionManager: { getSessionId: () => options.sessionId ?? "session-1" },
    ui: { notify: vi.fn() },
  };
}

type Harness = {
  api: ContextWindowPolicyApi;
  compactCalls: CompactOptions[];
  sentMessages: { message: unknown; options: unknown }[];
};

function harness(): Harness {
  const compactCalls: CompactOptions[] = [];
  const sentMessages: { message: unknown; options: unknown }[] = [];
  return {
    api: {
      onAgentSettled: () => undefined,
      onModelSelect: () => undefined,
      onSessionCompact: () => undefined,
      onSessionShutdown: () => undefined,
      onSessionStart: () => undefined,
      onTurnEnd: () => undefined,
      sendMessage: (message, options) => {
        sentMessages.push({ message, options });
      },
    },
    compactCalls,
    sentMessages,
  };
}

function complete(options: CompactOptions | undefined): void {
  options?.onComplete?.(COMPACTION_RESULT);
}

function fail(options: CompactOptions | undefined): void {
  options?.onError?.(new Error("checkpoint failed"));
}

describe("context-window threshold", () => {
  it("computes a safe integer 90% limit", () => {
    expect(autoCompactTokenLimit(272_000)).toBe(244_800);
    expect(autoCompactTokenLimit(11)).toBe(9);
    expect(autoCompactTokenLimit(Number.MAX_SAFE_INTEGER)).toBe(8_106_479_329_266_891);
    expect(autoCompactTokenLimit(0)).toBeUndefined();
    expect(autoCompactTokenLimit(Number.NaN)).toBeUndefined();
  });

  it("selects only the built-in Codex Responses model", () => {
    expect(
      isCodexNativeModel({
        api: "openai-codex-responses",
        contextWindow: 272_000,
        provider: "openai-codex",
      }),
    ).toBe(true);
    expect(
      isCodexNativeModel({
        api: "openai-codex-responses",
        contextWindow: 272_000,
        provider: "custom-codex",
      }),
    ).toBe(false);
    expect(isCodexNativeModel(undefined)).toBe(false);
  });
});

describe("turn-boundary compaction", () => {
  it("stops one tool loop exactly at 90%, compacts after settlement, and resumes once", () => {
    const h = harness();
    const abort = vi.fn();
    const ctx = context({
      abort,
      compact: (options) => h.compactCalls.push(options),
      tokens: 244_800,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), ctx);
    controller.turnEnded(turnEvent(), ctx);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(h.compactCalls).toHaveLength(0);

    controller.agentSettled(ctx);
    expect(h.compactCalls).toHaveLength(1);
    complete(h.compactCalls[0]);
    complete(h.compactCalls[0]);

    expect(h.sentMessages).toEqual([
      {
        message: {
          content: CONTINUATION_PROMPT,
          customType: CONTINUATION_MESSAGE_KIND,
          display: false,
        },
        options: { deliverAs: "followUp", triggerTurn: true },
      },
    ]);
  });

  it("does not interrupt below the limit, non-tool turns, or unsupported models", () => {
    const h = harness();
    const abort = vi.fn();
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), context({ abort, tokens: 244_799 }));
    controller.turnEnded(turnEvent(false), context({ abort, tokens: 244_800 }));
    controller.turnEnded(turnEvent(), context({ abort, model: "custom", tokens: 272_000 }));
    controller.turnEnded(turnEvent(), context({ abort, model: "none", tokens: 272_000 }));
    controller.turnEnded(turnEvent(), context({ abort, tokens: null }));

    expect(abort).not.toHaveBeenCalled();
  });

  it("compacts a completed final turn without starting an unnecessary continuation", () => {
    const h = harness();
    const ctx = context({
      compact: (options) => h.compactCalls.push(options),
      tokens: 250_000,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(false), ctx);
    controller.agentSettled(ctx);
    complete(h.compactCalls[0]);

    expect(h.compactCalls).toHaveLength(1);
    expect(h.sentMessages).toEqual([]);
  });

  it("uses a completed built-in compaction instead of starting a duplicate", () => {
    const h = harness();
    const abort = vi.fn();
    const ctx = context({
      abort,
      compact: (options) => h.compactCalls.push(options),
      tokens: 260_000,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), ctx);
    controller.sessionCompacted(compactEvent(), ctx);
    controller.agentSettled(ctx);

    expect(abort).toHaveBeenCalledOnce();
    expect(h.compactCalls).toEqual([]);
    expect(h.sentMessages).toHaveLength(1);
  });

  it("lets Pi own overflow retry without a duplicate continuation", () => {
    const h = harness();
    const ctx = context({ tokens: 272_000 });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), ctx);
    controller.sessionCompacted(compactEvent(true), ctx);
    controller.agentSettled(ctx);

    expect(h.compactCalls).toEqual([]);
    expect(h.sentMessages).toEqual([]);
  });

  it("remembers queued work even when aborting clears Pi's pending queue", () => {
    const h = harness();
    const turnCtx = context({ hasPendingMessages: true, tokens: 244_800 });
    const settledCtx = context({
      compact: (options) => h.compactCalls.push(options),
      hasPendingMessages: false,
      tokens: 244_800,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), turnCtx);
    controller.agentSettled(settledCtx);
    complete(h.compactCalls[0]);

    expect(h.sentMessages).toEqual([]);
  });

  it("defers compaction over settlement work and suppresses its continuation", () => {
    const h = harness();
    const abort = vi.fn();
    const compact = (options: CompactOptions) => h.compactCalls.push(options);
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), context({ abort, tokens: 244_800 }));
    controller.agentSettled(context({ compact, isIdle: false, tokens: 244_800 }));
    controller.agentSettled(context({ compact, hasPendingMessages: true, tokens: 244_800 }));
    expect(h.compactCalls).toEqual([]);

    controller.agentSettled(context({ compact, tokens: 244_800 }));
    complete(h.compactCalls[0]);

    expect(abort).toHaveBeenCalledOnce();
    expect(h.compactCalls).toHaveLength(1);
    expect(h.sentMessages).toEqual([]);
  });

  it("defers final-turn compaction until settlement work finishes", () => {
    const h = harness();
    const compact = (options: CompactOptions) => h.compactCalls.push(options);
    const controller = createContextWindowPolicyController(h.api);

    controller.agentSettled(context({ compact, isIdle: false, tokens: 244_800 }));
    expect(h.compactCalls).toEqual([]);

    controller.agentSettled(context({ compact, tokens: 244_800 }));
    complete(h.compactCalls[0]);

    expect(h.compactCalls).toHaveLength(1);
    expect(h.sentMessages).toEqual([]);
  });

  it("releases failed requests and permits a later retry", () => {
    const h = harness();
    const ctx = context({
      compact: (options) => h.compactCalls.push(options),
      tokens: 244_800,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), ctx);
    controller.agentSettled(ctx);
    fail(h.compactCalls[0]);
    controller.turnEnded(turnEvent(), ctx);
    controller.agentSettled(ctx);

    expect(h.compactCalls).toHaveLength(2);
  });

  it("ignores stale callbacks after lifecycle reset", () => {
    const h = harness();
    const ctx = context({
      compact: (options) => h.compactCalls.push(options),
      tokens: 244_800,
    });
    const controller = createContextWindowPolicyController(h.api);

    controller.turnEnded(turnEvent(), ctx);
    controller.agentSettled(ctx);
    controller.reset();
    complete(h.compactCalls[0]);

    expect(h.sentMessages).toEqual([]);
  });
});
