import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { UsageReport } from "@onurpi/pi-usage";
import { describe, expect, it, vi } from "vitest";

import type { CodexAccount } from "./config.ts";
import {
  createCodexSwitcherStream,
  isTerminalUsageLimit,
  type SwitcherRuntime,
  type SwitcherState,
} from "./router.ts";

const primary: CodexAccount = { id: "primary", billing: "subscription-only" };
const backup: CodexAccount = { id: "backup", billing: "allow-credits" };
type CodexModel = Model<"openai-codex-responses">;

function model(): CodexModel {
  return {
    id: "gpt-test",
    name: "GPT test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function assistant(
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider: "openai-codex",
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

function usage(
  remaining: number,
  credits: number | string = "none",
  resetsAt?: number,
): UsageReport {
  return {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 1,
    source: "test",
    semantics: { kind: "consumer-subscription", label: "Subscription" },
    buckets: [
      {
        id: "codex:primary",
        groupId: "codex",
        label: "Primary",
        remaining,
        unit: "percent",
        ...(resetsAt === undefined ? {} : { resetsAt }),
      },
    ],
    metrics: [{ id: "credits", label: "Credits", value: credits }],
  };
}

function stream(events: readonly AssistantMessageEvent[]) {
  if (events.length === 0) {
    return {
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ done: true, value: undefined }) };
      },
    } as unknown as ReturnType<typeof createAssistantMessageEventStream>;
  }
  const output = createAssistantMessageEventStream();
  for (const event of events) output.push(event);
  return output;
}

function successEvents(): AssistantMessageEvent[] {
  const partial = assistant("pending");
  return [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "text_delta", contentIndex: 0, delta: "ok", partial },
    { type: "text_end", contentIndex: 0, content: "ok", partial },
    { type: "done", reason: "stop", message: assistant() },
  ];
}

function errorEvents(message: string, afterText = false): AssistantMessageEvent[] {
  const partial = assistant("pending");
  return [
    { type: "start", partial },
    ...(afterText ? [{ type: "text_start" as const, contentIndex: 0, partial }] : []),
    { type: "error", reason: "error", error: assistant("error", message) },
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
    activeAccountId: undefined,
    agentRunActive: false,
    leaseAccountId: undefined,
    usageByAccount: new Map(),
  };
  const authenticated = new Set(options.authenticated ?? [primary.id, backup.id]);
  const runtime: SwitcherRuntime = {
    getAuth: (accountId) => {
      authCalls.push(accountId);
      return Promise.resolve(
        authenticated.has(accountId) ? { apiKey: `token-${accountId}` } : undefined,
      );
    },
    queryUsage: (account) => {
      const value = options.reports?.[account.id] ?? usage(50);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
    clearUsage: (account) => {
      cleared.push(account.id);
    },
    activateAccount: (account) => {
      activated.push(account.id);
    },
  };
  const transport = vi.fn(
    (_requestModel: CodexModel, _context: Context, streamOptions?: StreamOptions) => {
      const account = streamOptions?.apiKey?.replace("token-", "") ?? "missing";
      calls.push(account);
      return stream(options.streams?.[account] ?? successEvents());
    },
  );
  const route = createCodexSwitcherStream({
    getAccounts: () => [primary, backup],
    runtime,
    state,
    transport,
  });
  return { activated, authCalls, calls, cleared, route, state, transport };
}

describe("Codex account routing", () => {
  it("starts each unleased request with the preferred account", async () => {
    const test = setup();
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.provider).toBe("openai-codex");
    expect(test.calls).toEqual(["primary"]);
    expect(test.state.activeAccountId).toBe("primary");
  });

  it("skips unauthenticated and exhausted subscription-only accounts", async () => {
    const unauthenticated = setup({ authenticated: [backup.id] });
    await unauthenticated.route(model(), { messages: [] }).result();
    expect(unauthenticated.calls).toEqual(["backup"]);

    const exhausted = setup({ reports: { primary: usage(0), backup: usage(50) } });
    await exhausted.route(model(), { messages: [] }).result();
    expect(exhausted.calls).toEqual(["backup"]);
  });

  it("permits credits only for an account with explicit policy and confirmed credits", async () => {
    const allowed = setup({ reports: { primary: usage(0, 100), backup: usage(0, 100) } });
    await allowed.route(model(), { messages: [] }).result();
    expect(allowed.calls).toEqual(["backup"]);

    const denied = setup({ reports: { primary: usage(0), backup: usage(0) } });
    const result = await denied.route(model(), { messages: [] }).result();
    expect(result.errorMessage).toContain("No authenticated Codex account");
  });

  it("falls back for a confirmed limit error before semantic output", async () => {
    const test = setup({
      streams: {
        primary: errorEvents("usage limit reached"),
        backup: successEvents(),
      },
    });
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("stop");
    expect(test.calls).toEqual(["primary", "backup"]);
    expect(test.cleared).toEqual(["primary"]);
  });

  it("does not fall back after semantic output or for unrelated errors", async () => {
    const afterText = setup({
      streams: { primary: errorEvents("usage limit reached", true), backup: successEvents() },
    });
    await afterText.route(model(), { messages: [] }).result();
    expect(afterText.calls).toEqual(["primary"]);

    const network = setup({
      streams: { primary: errorEvents("network error"), backup: successEvents() },
    });
    await network.route(model(), { messages: [] }).result();
    expect(network.calls).toEqual(["primary"]);
  });

  it("leases the first semantic account for later calls in the same agent run", async () => {
    const test = setup({
      reports: { primary: usage(0), backup: usage(50) },
      streams: { backup: successEvents() },
    });
    test.state.agentRunActive = true;
    await test.route(model(), { messages: [] }).result();
    expect(test.state.leaseAccountId).toBe("backup");

    await test.route(model(), { messages: [] }).result();
    expect(test.calls).toEqual(["backup", "backup"]);
    expect(test.authCalls).toEqual(["primary", "backup", "backup"]);
  });

  it("does not leave a leased account after a later limit response", async () => {
    const test = setup({ streams: { primary: successEvents() } });
    test.state.agentRunActive = true;
    await test.route(model(), { messages: [] }).result();
    test.transport.mockImplementationOnce(() => stream(errorEvents("usage limit reached")));
    const result = await test.route(model(), { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(test.authCalls.at(-1)).toBe("primary");
    expect(test.authCalls).not.toContain("backup");
  });

  it("tries requests when usage checks are unavailable", async () => {
    const test = setup({ reports: { primary: new Error("private provider payload") } });
    await test.route(model(), { messages: [] }).result();
    expect(test.calls).toEqual(["primary"]);
    expect(test.state.usageByAccount.get("primary")).toEqual({
      status: "failed",
      message: "usage check unavailable",
    });
  });

  it("rejects non-official provider identity and endpoint", async () => {
    const wrongProvider = { ...model(), provider: "openai-codex-primary" };
    const result = await setup().route(wrongProvider, { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Codex account routing failed.");
  });

  it("returns an error when no account remains or the stream ends early", async () => {
    const none = setup({ authenticated: [] });
    expect((await none.route(model(), { messages: [] }).result()).errorMessage).toContain(
      "No authenticated Codex account",
    );

    const ended = setup({ streams: { primary: [] } });
    expect((await ended.route(model(), { messages: [] }).result()).errorMessage).toBe(
      "Codex provider stream ended without a terminal event.",
    );
  });
});

it("classifies only terminal quota and billing errors", () => {
  expect(isTerminalUsageLimit(assistant("error", "insufficient_quota"))).toBe(true);
  expect(isTerminalUsageLimit(assistant("error", "Your available balance is too low"))).toBe(true);
  expect(isTerminalUsageLimit(assistant("error", "billing service unavailable"))).toBe(false);
  expect(isTerminalUsageLimit(assistant("error", "network error"))).toBe(false);
  expect(isTerminalUsageLimit(assistant("stop"))).toBe(false);
});
