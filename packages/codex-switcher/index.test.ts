import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigLoadResult } from "./config.ts";
import { installCodexSwitcher } from "./index.ts";

type CodexModel = Model<"openai-codex-responses">;
type EventHandler = (event: unknown, context: unknown) => unknown;

afterEach(() => {
  vi.unstubAllGlobals();
});

function readyConfig(): Extract<ConfigLoadResult, { status: "ready" }> {
  return {
    status: "ready",
    config: {
      profiles: [
        {
          id: "primary",
          label: "Primary",
          billing: "subscription-only",
          providerId: "openai-codex-primary",
        },
        {
          id: "backup",
          label: "Backup",
          billing: "allow-credits",
          providerId: "openai-codex-backup",
        },
      ],
      fallbackChain: ["primary", "backup"],
      refreshMs: 300_000,
      timeoutMs: 10_000,
    },
  };
}

function harness() {
  const providers: Provider[] = [];
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const events: string[] = [];
  const handlers = new Map<string, EventHandler[]>();
  let currentContext: { model?: CodexModel } | undefined;
  const selected: CodexModel[] = [];
  const api = {
    registerProvider(provider: Provider) {
      providers.push(provider);
    },
    registerCommand(name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      commands.set(name, command);
    },
    on(event: string, handler: EventHandler) {
      events.push(event);
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    setModel(model: CodexModel) {
      selected.push(model);
      if (currentContext) currentContext.model = model;
      return Promise.resolve(true);
    },
  };
  const emit = async (event: string, value: unknown, context: { model?: CodexModel }) => {
    currentContext = context;
    for (const handler of handlers.get(event) ?? []) await handler(value, context);
  };
  return {
    api: api as unknown as ExtensionAPI,
    providers,
    commands,
    events,
    emit,
    selected,
  };
}

function assistant(provider: string): AssistantMessage {
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
    stopReason: "stop",
    timestamp: 1,
  };
}

function successfulStream() {
  const output = createAssistantMessageEventStream();
  output.push({ type: "done", reason: "stop", message: assistant("openai-codex") });
  return output;
}

function testNativeProvider(): Provider<"openai-codex-responses"> {
  const native = openaiCodexProvider();
  return {
    ...native,
    stream: () => successfulStream(),
    streamSimple: () => successfulStream(),
  };
}

function usageResponse(usedPercent: number): Response {
  return new Response(
    JSON.stringify({
      rate_limit: { primary_window: { used_percent: usedPercent } },
      credits: { has_credits: false },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("installCodexSwitcher", () => {
  it("registers one complete OAuth provider per configured profile", () => {
    const test = harness();
    const native = openaiCodexProvider();
    installCodexSwitcher(test.api, { configResult: readyConfig(), nativeProvider: native });

    expect(test.providers.map((provider) => provider.id)).toEqual([
      "openai-codex-primary",
      "openai-codex-backup",
    ]);
    for (const provider of test.providers) {
      expect(provider.auth.oauth).toBe(native.auth.oauth);
      expect(provider.getModels()).not.toHaveLength(0);
      expect(provider.getModels().every((model) => model.provider === provider.id)).toBe(true);
    }
    expect(test.commands.has("codex-switcher")).toBe(true);
    expect(test.events).toEqual([
      "session_start",
      "model_select",
      "agent_start",
      "agent_settled",
      "session_shutdown",
    ]);
  });

  it("routes and rejects custom endpoints on the full stream API", async () => {
    const test = harness();
    installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: openaiCodexProvider(),
    });
    const provider = test.providers[0];
    const registeredModel = provider?.getModels()[0];
    if (!provider || !registeredModel) throw new Error("Expected a registered profile model");
    const result = await provider
      .stream({ ...registeredModel, baseUrl: "https://example.com/backend-api" }, { messages: [] })
      .result();
    expect(result.errorMessage).toContain("Codex profile authentication is restricted");
  });

  it("selects a fallback during a run and restores the preferred profile when settled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Promise.resolve(usageResponse(authorization.includes("primary") ? 100 : 50));
      }),
    );
    const test = harness();
    installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: testNativeProvider(),
    });
    const primaryProvider = test.providers[0];
    const primaryModel = primaryProvider?.getModels()[0] as CodexModel | undefined;
    if (!primaryProvider || !primaryModel) throw new Error("Expected the primary profile model");
    const context = {
      model: primaryModel,
      modelRegistry: {
        getProviderAuth: (providerId: string) =>
          Promise.resolve({ auth: { apiKey: `token-${providerId}` } }),
        getProviderAuthStatus: () => ({ configured: true }),
      },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    };

    await test.emit("session_start", { type: "session_start", reason: "startup" }, context);
    await test.emit("agent_start", { type: "agent_start" }, context);
    const result = await primaryProvider.stream(primaryModel, { messages: [] }).result();

    expect(result.provider).toBe("openai-codex-backup");
    expect(test.selected[0]?.provider).toBe("openai-codex-backup");
    await test.emit("agent_settled", { type: "agent_settled" }, context);
    expect(test.selected[1]?.provider).toBe("openai-codex-primary");
    expect(context.model.provider).toBe("openai-codex-primary");
  });

  it("registers only diagnostics when configuration is missing", async () => {
    const test = harness();
    installCodexSwitcher(test.api, {
      configPath: "/agent/codex-switcher.json",
      configResult: { status: "missing" },
    });
    expect(test.providers).toHaveLength(0);
    expect(test.events).toHaveLength(0);

    const notify = vi.fn();
    const command = test.commands.get("codex-switcher");
    if (!command) throw new Error("Expected diagnostic command");
    await command.handler("", { ui: { notify } } as never);
    expect(notify).toHaveBeenCalledWith(
      "Codex switcher configuration is missing: /agent/codex-switcher.json",
      "warning",
    );
  });

  it("reports invalid configuration without registering profile providers", async () => {
    const test = harness();
    installCodexSwitcher(test.api, {
      configResult: { status: "invalid", message: "profiles must contain at least one profile." },
    });
    const notify = vi.fn();
    const command = test.commands.get("codex-switcher");
    if (!command) throw new Error("Expected diagnostic command");
    await command.handler("", { ui: { notify } } as never);
    expect(notify).toHaveBeenCalledWith(
      "Codex switcher configuration is invalid: profiles must contain at least one profile.",
      "error",
    );
  });
});
