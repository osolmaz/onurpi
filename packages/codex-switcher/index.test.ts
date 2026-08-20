import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigLoadResult } from "./config.ts";
import {
  installCodexSwitcher,
  installCodexSwitcherExtension,
  installCodexSwitcherStartup,
} from "./index.ts";
import type { AccountVault } from "./vault.ts";

type CodexModel = Model<"openai-codex-responses">;
type CodexProvider = Provider<"openai-codex-responses">;
type EventHandler = (event: never, context: never) => unknown;

function assistant(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
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
    timestamp: 1,
  };
}

function successfulStream(): ReturnType<typeof createAssistantMessageEventStream> {
  const output = createAssistantMessageEventStream();
  const partial = assistant("pending");
  const events: AssistantMessageEvent[] = [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "done", reason: "stop", message: assistant() },
  ];
  for (const event of events) output.push(event);
  return output;
}

function readyConfig(): Extract<ConfigLoadResult, { status: "ready" }> {
  return {
    status: "ready",
    config: {
      accounts: [
        { id: "primary", billing: "subscription-only" },
        { id: "backup", billing: "allow-credits" },
      ],
      refreshMs: 300_000,
      timeoutMs: 10_000,
    },
  };
}

function fakeVault(authenticated = ["primary", "backup"]): AccountVault {
  const accounts = new Set(authenticated);
  return {
    has: (id) => Promise.resolve(accounts.has(id)),
    hasAnySync: (ids) => ids.some((id) => accounts.has(id)),
    list: () => Promise.resolve([...accounts]),
    remove: (id) => Promise.resolve(accounts.delete(id)),
    resolve: (id) => Promise.resolve(accounts.has(id) ? { apiKey: `token-${id}` } : undefined),
    set: (id) => {
      accounts.add(id);
      return Promise.resolve();
    },
  };
}

function fakeNative(requests: string[]): CodexProvider {
  const native = openaiCodexProvider();
  const transport = (_model: CodexModel, _context: unknown, options?: StreamOptions) => {
    requests.push(options?.apiKey ?? "missing");
    return successfulStream();
  };
  return {
    ...native,
    stream: transport as CodexProvider["stream"],
    streamSimple: transport as CodexProvider["streamSimple"],
  };
}

function harness() {
  const providers: Provider[] = [];
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, EventHandler[]>();
  const api = {
    exec: vi.fn(() => Promise.resolve({ code: 0, stdout: "", stderr: "", killed: false })),
    registerProvider(provider: Provider) {
      providers.push(provider);
    },
    unregisterProvider(providerId: string) {
      const retained = providers.filter((provider) => provider.id !== providerId);
      providers.splice(0, providers.length, ...retained);
    },
    registerCommand(name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      commands.set(name, command);
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const emit = async (event: string, value: unknown, context: unknown) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(value as never, context as never);
    }
  };
  return { api: api as unknown as ExtensionAPI, commands, emit, handlers, providers };
}

function usageResponse(usedPercent: number): Response {
  return new Response(
    JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: usedPercent, limit_window_seconds: 18_000 },
      },
      credits: { has_credits: true, unlimited: false, balance: "10" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installCodexSwitcher", () => {
  it("overrides one built-in provider and keeps normal model identity", async () => {
    const requests: string[] = [];
    const test = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(usageResponse(50)));
    const runtime = installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: fakeNative(requests),
      vault: fakeVault(),
    });

    expect(runtime?.isAuthenticationReady()).toBe(true);
    expect(test.providers).toHaveLength(1);
    const provider = test.providers[0] as CodexProvider;
    expect(provider.id).toBe("openai-codex");
    expect(new Set(provider.getModels().map((value) => value.provider))).toEqual(
      new Set(["openai-codex"]),
    );
    expect(
      await provider.auth.apiKey?.check?.({
        ctx: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ type: "oauth" });

    const model = provider.getModels()[0] as CodexModel;
    const setStatus = vi.fn();
    const context = { model, ui: { notify: vi.fn(), setStatus } };
    await test.emit("session_start", {}, context);
    await test.emit("before_agent_start", {}, context);
    expect((await provider.stream(model, { messages: [] }).result()).provider).toBe("openai-codex");
    expect(requests).toEqual(["token-primary"]);
    expect(setStatus).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith("codex-switcher", undefined);
    await test.emit("agent_settled", {}, context);
  });
});

describe("codex switcher startup", () => {
  it("restores startup authentication when the provider binds without lifecycle events", () => {
    const test = harness();
    const runtime = installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: fakeNative([]),
      vault: fakeVault(),
    });
    expect(runtime).toBeDefined();
    if (!runtime) return;
    const originalAuth = vi.fn((providerId: string) => providerId === "canonical-ready");
    const runtimePrototype = { hasConfiguredAuth: originalAuth };
    const originalGetModels = Reflect.get(runtime.provider, "getModels");

    installCodexSwitcherStartup(test.api, runtime, {
      piVersion: "0.84.2",
      runtimePrototype,
    });
    expect(runtimePrototype.hasConfiguredAuth("openai-codex")).toBe(true);

    runtime.provider.getModels();

    expect(runtimePrototype.hasConfiguredAuth).toBe(originalAuth);
    expect(Reflect.get(runtime.provider, "getModels")).toBe(originalGetModels);
  });

  it("restores startup authentication behavior after the session starts", async () => {
    const test = harness();
    const runtime = installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: fakeNative([]),
      vault: fakeVault(),
    });
    expect(runtime).toBeDefined();
    if (!runtime) return;
    const original = vi.fn((providerId: string) => providerId === "canonical-ready");
    const runtimePrototype = { hasConfiguredAuth: original };
    const restore = installCodexSwitcherStartup(test.api, runtime, {
      piVersion: "0.84.2",
      runtimePrototype,
    });

    expect(runtimePrototype.hasConfiguredAuth("openai-codex")).toBe(true);
    expect(runtimePrototype.hasConfiguredAuth("other-provider")).toBe(false);
    await test.emit("session_start", {}, { ui: { setStatus: vi.fn() } });
    expect(runtimePrototype.hasConfiguredAuth).toBe(original);
    restore();
  });

  it("preserves another queued provider when the Pi version is unsupported", () => {
    const test = harness();
    const existing = fakeNative([]);
    test.api.registerProvider(existing);

    expect(() =>
      installCodexSwitcherExtension(
        test.api,
        {
          configResult: readyConfig(),
          nativeProvider: fakeNative([]),
          vault: fakeVault(),
        },
        { piVersion: "0.85.0" },
      ),
    ).toThrow("supports Pi >=0.84.2 <0.85.0");
    expect(test.providers).toEqual([existing]);
  });

  it("does not queue its provider when lifecycle registration fails", () => {
    const test = harness();
    const existing = fakeNative([]);
    test.api.registerProvider(existing);
    const original = vi.fn((providerId: string) => providerId === "canonical-ready");
    const runtimePrototype = { hasConfiguredAuth: original };
    const failingApi = {
      ...test.api,
      on: vi.fn(() => {
        throw new Error("registration failed");
      }),
    } as ExtensionAPI;

    expect(() =>
      installCodexSwitcherExtension(
        failingApi,
        {
          configResult: readyConfig(),
          nativeProvider: fakeNative([]),
          vault: fakeVault(),
        },
        { piVersion: "0.84.2", runtimePrototype },
      ),
    ).toThrow("registration failed");
    expect(runtimePrototype.hasConfiguredAuth).toBe(original);
    expect(test.providers).toEqual([existing]);
  });
});

describe("installCodexSwitcher", () => {
  it("starts a lease for extension-triggered agent runs", async () => {
    const requests: string[] = [];
    const test = harness();
    const vault = fakeVault();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(usageResponse(50)));
    installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: fakeNative(requests),
      vault,
    });
    const provider = test.providers[0] as CodexProvider;
    const model = provider.getModels()[0] as CodexModel;
    const context = { model, ui: { notify: vi.fn(), setStatus: vi.fn() } };

    await test.emit("agent_start", {}, context);
    await provider.stream(model, { messages: [] }).result();
    const confirm = vi.fn(() => Promise.resolve(true));
    const notify = vi.fn();
    await test.commands.get("codex-switcher")?.handler("remove primary", {
      ui: { confirm, notify },
    } as never);

    expect(requests).toEqual(["token-primary"]);
    expect(confirm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Wait for the current Codex run to finish before changing account: primary",
      "error",
    );
    await expect(vault.has("primary")).resolves.toBe(true);
    await test.emit("agent_settled", {}, context);
  });

  it("routes to the next account without registering a provider alias", async () => {
    const requests: string[] = [];
    const test = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        return Promise.resolve(usageResponse(auth?.includes("primary") ? 100 : 50));
      }),
    );
    installCodexSwitcher(test.api, {
      configResult: readyConfig(),
      nativeProvider: fakeNative(requests),
      vault: fakeVault(),
    });
    const provider = test.providers[0] as CodexProvider;
    const model = provider.getModels()[0] as CodexModel;
    await provider.stream(model, { messages: [] }).result();
    expect(requests).toEqual(["token-backup"]);
    expect(test.providers.map((value) => value.id)).toEqual(["openai-codex"]);
    await expect(
      provider.auth.apiKey?.resolve({
        ctx: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ auth: { apiKey: "token-backup" } });
  });

  it("keeps the account manager available with a missing configuration", async () => {
    const test = harness();
    const runtime = installCodexSwitcher(test.api, {
      configPath: "/agent/codex-switcher.json",
      configResult: { status: "missing" },
      nativeProvider: fakeNative([]),
      vault: fakeVault([]),
    });
    expect(runtime?.isAuthenticationReady()).toBe(false);
    expect(test.providers.map((provider) => provider.id)).toEqual(["openai-codex"]);
    const notify = vi.fn();
    await test.commands.get("codex-switcher")?.handler("status", {
      ui: { notify },
    } as never);
    expect(notify).toHaveBeenCalledWith("No Codex accounts are configured.", "info");
  });

  it("does not override the provider when configuration is invalid", async () => {
    const test = harness();
    installCodexSwitcher(test.api, {
      configResult: { status: "invalid", message: "accounts has an unknown field." },
    });
    expect(test.providers).toHaveLength(0);
    const notify = vi.fn();
    await test.commands.get("codex-switcher")?.handler("", { ui: { notify } } as never);
    expect(notify).toHaveBeenCalledWith(
      "Codex switcher configuration is invalid: accounts has an unknown field.",
      "error",
    );
  });
});
