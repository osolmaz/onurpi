import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import type { UsageReport } from "@onurpi/pi-usage";
import { describe, expect, it, vi } from "vitest";

import type { CodexProfile } from "./config.ts";
import {
  createCodexSwitcherStream,
  isTerminalUsageLimit,
  type SwitcherRuntime,
  type SwitcherState,
} from "./router.ts";

type CodexModel = Model<"openai-codex-responses">;

const primary: CodexProfile = {
  id: "primary",
  label: "Primary",
  billing: "subscription-only",
  providerId: "openai-codex-primary",
};
const backup: CodexProfile = {
  id: "backup",
  label: "Backup",
  billing: "allow-credits",
  providerId: "openai-codex-backup",
};

function model(provider = primary.providerId): CodexModel {
  return {
    id: "gpt-test",
    name: "GPT test",
    api: "openai-codex-responses",
    provider,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function assistant(
  provider: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider,
    model: "gpt-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 1,
  };
}

function usage(remaining: number, credits: number | string = "none"): UsageReport {
  return {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 1,
    source: "test",
    semantics: { kind: "consumer-subscription", label: "Subscription" },
    buckets: [
      { id: "codex:primary", groupId: "codex", label: "Primary", remaining, unit: "percent" },
    ],
    metrics: [{ id: "credits", label: "Credits", value: credits }],
  };
}

function stream(events: readonly AssistantMessageEvent[]) {
  if (events.length === 0) {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.resolve({ done: true, value: undefined }),
        };
      },
    } as unknown as ReturnType<typeof createAssistantMessageEventStream>;
  }
  const output = createAssistantMessageEventStream();
  for (const event of events) output.push(event);
  return output;
}

function successEvents(): AssistantMessageEvent[] {
  const partial = assistant("openai-codex", "pending");
  const done = assistant("openai-codex");
  return [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "text_delta", contentIndex: 0, delta: "ok", partial },
    { type: "text_end", contentIndex: 0, content: "ok", partial },
    { type: "done", reason: "stop", message: done },
  ];
}

function errorEvents(message: string, afterText = false): AssistantMessageEvent[] {
  const partial = assistant("openai-codex", "pending");
  const error = assistant("openai-codex", "error", message);
  return [
    { type: "start", partial },
    ...(afterText ? [{ type: "text_start" as const, contentIndex: 0, partial }] : []),
    { type: "error", reason: "error", error },
  ];
}

function setup(
  options: {
    reports?: Partial<Record<string, UsageReport | Error | undefined>>;
    streams?: Partial<Record<string, AssistantMessageEvent[]>>;
    authenticated?: readonly string[];
  } = {},
) {
  const calls: string[] = [];
  const authCalls: string[] = [];
  const activated: string[] = [];
  const cleared: string[] = [];
  const state: SwitcherState = {
    agentRunActive: false,
    runProfileId: undefined,
    usageByProfile: new Map(),
  };
  const authenticated = new Set(options.authenticated ?? [primary.id, backup.id]);
  const runtime: SwitcherRuntime = {
    getAuth: (providerId) => {
      authCalls.push(providerId);
      return Promise.resolve(
        [...authenticated].some((id) => providerId.endsWith(id))
          ? { auth: { apiKey: `token-${providerId}` } }
          : undefined,
      );
    },
    queryUsage: (profile) => {
      const value = options.reports?.[profile.id] ?? usage(50);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
    clearUsage: (profile) => {
      cleared.push(profile.id);
    },
    activateProfile: (profile) => {
      activated.push(profile.id);
      return Promise.resolve();
    },
  };
  const transport = vi.fn((requestModel: CodexModel, context: Context) => {
    const token = context.systemPrompt ?? "";
    const profile = token.includes("backup")
      ? backup.id
      : token.includes("primary")
        ? primary.id
        : calls.length === 0
          ? primary.id
          : backup.id;
    calls.push(profile);
    expect(requestModel.provider).toBe("openai-codex");
    return stream(options.streams?.[profile] ?? successEvents());
  });
  const route = createCodexSwitcherStream({
    profiles: [primary, backup],
    fallbackChain: [primary.id, backup.id],
    runtime,
    state,
    transport: (requestModel, context, streamOptions) => {
      const apiKey = streamOptions?.apiKey ?? "";
      const profileContext = {
        ...context,
        systemPrompt: apiKey.includes("backup") ? "backup" : "primary",
      };
      return transport(requestModel, profileContext);
    },
  });
  return { route, calls, authCalls, activated, cleared, state, transport };
}

describe("createCodexSwitcherStream", () => {
  it("skips an exhausted subscription profile without changing the preferred model", async () => {
    const test = setup({ reports: { primary: usage(0), backup: usage(0, 20) } });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.provider).toBe(backup.providerId);
    expect(test.calls).toEqual([backup.id]);
    expect(test.activated).toEqual([backup.id]);
    expect(test.state.activeProfileId).toBe(backup.id);
  });

  it("keeps a fallback for one agent run and climbs back on the next run", async () => {
    let primaryRemaining = 0;
    const reports = { backup: usage(50) } as Partial<Record<string, UsageReport>>;
    Object.defineProperty(reports, "primary", {
      enumerable: true,
      get: () => usage(primaryRemaining),
    });
    const test = setup({ reports });

    test.state.agentRunActive = true;
    await test.route(model(), { messages: [] }).result();
    expect(test.state.runProfileId).toBe(backup.id);

    primaryRemaining = 50;
    await test.route(model(), { messages: [] }).result();
    expect(test.calls).toEqual([backup.id, backup.id]);

    test.state.agentRunActive = false;
    test.state.runProfileId = undefined;
    test.state.agentRunActive = true;
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.provider).toBe(primary.providerId);
    expect(test.calls).toEqual([backup.id, backup.id, primary.id]);
    expect(test.state.runProfileId).toBe(primary.id);
  });

  it("tries a profile when its usage check fails", async () => {
    const test = setup({ reports: { primary: new Error("usage offline") } });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("stop");
    expect(test.calls).toEqual([primary.id]);
    expect(test.state.usageByProfile.get(primary.id)).toMatchObject({ status: "failed" });
  });

  it("falls back for a terminal usage error before output", async () => {
    const test = setup({
      streams: { primary: errorEvents("FreeUsageLimitError: usage limit reached") },
    });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.provider).toBe(backup.providerId);
    expect(test.calls).toEqual([primary.id, backup.id]);
    expect(test.cleared).toEqual([primary.id]);
  });

  it("does not fall back after semantic output starts", async () => {
    const test = setup({
      streams: { primary: errorEvents("usage limit reached", true) },
    });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(result.provider).toBe(primary.providerId);
    expect(test.calls).toEqual([primary.id]);
  });

  it("does not fall back for ordinary provider errors", async () => {
    const test = setup({ streams: { primary: errorEvents("network connection failed") } });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.errorMessage).toBe("network connection failed");
    expect(test.calls).toEqual([primary.id]);
  });

  it("does not fall back for an unrelated billing error", async () => {
    const test = setup({ streams: { primary: errorEvents("billing service unavailable") } });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.errorMessage).toBe("billing service unavailable");
    expect(test.calls).toEqual([primary.id]);
  });

  it("rejects a custom endpoint before resolving profile auth", async () => {
    const test = setup();
    const result = await test
      .route({ ...model(), baseUrl: "https://example.com/backend-api" }, { messages: [] })
      .result();
    expect(result.errorMessage).toContain("restricted to https://chatgpt.com/backend-api");
    expect(test.calls).toEqual([]);
    expect(test.authCalls).toEqual([]);
  });

  it("returns an error when the provider stream ends without a terminal event", async () => {
    const test = setup({ streams: { primary: [] } });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Codex provider stream ended without a terminal event.");
    expect(test.calls).toEqual([primary.id]);
  });

  it("starts from the explicitly selected profile", async () => {
    const test = setup();
    const result = await test.route(model(backup.providerId), { messages: [] }).result();
    expect(result.provider).toBe(backup.providerId);
    expect(test.calls).toEqual([backup.id]);
  });

  it("skips profiles without auth", async () => {
    const test = setup({ authenticated: [backup.id] });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.provider).toBe(backup.providerId);
    expect(test.calls).toEqual([backup.id]);
  });

  it("returns a clear error when no eligible profile remains", async () => {
    const test = setup({ authenticated: [] });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("No authenticated Codex profile");
  });

  it("maps profile assistant history to the built-in provider", async () => {
    const test = setup();
    const history = assistant(primary.providerId);
    test.transport.mockImplementationOnce((requestModel, context) => {
      expect(requestModel.provider).toBe("openai-codex");
      expect(context.messages[0]).toMatchObject({ provider: "openai-codex" });
      return stream(successEvents());
    });
    await test.route(model(), { messages: [history] }).result();
  });
});

it("classifies only terminal quota and billing errors", () => {
  expect(isTerminalUsageLimit(assistant("openai-codex", "error", "insufficient_quota"))).toBe(true);
  expect(
    isTerminalUsageLimit(assistant("openai-codex", "error", "Your available balance is too low")),
  ).toBe(true);
  expect(
    isTerminalUsageLimit(assistant("openai-codex", "error", "billing service unavailable")),
  ).toBe(false);
  expect(isTerminalUsageLimit(assistant("openai-codex", "error", "network error"))).toBe(false);
  expect(isTerminalUsageLimit(assistant("openai-codex", "stop"))).toBe(false);
});
