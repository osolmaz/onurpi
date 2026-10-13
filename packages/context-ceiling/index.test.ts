import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import contextCeiling from "./index.ts";
import { DEFAULT_RESERVE_TOKENS, type CatalogModel } from "./cap.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakeModel = CatalogModel & { provider: string };

type RegisteredProvider = { name: string; config: { models?: unknown[] } };

type FakePi = {
  on: (event: string, handler: Handler) => () => void;
  registerCommand: (name: string, options: { description?: string; handler: Handler }) => void;
  registerProvider: (name: string, config: { models?: unknown[] }) => void;
  unregisterProvider: (name: string) => void;
  setModel: (model: FakeModel) => Promise<boolean>;
};

type Recorded = {
  pi: FakePi;
  handlers: Map<string, Handler[]>;
  commands: { name: string; handler: Handler }[];
  notifications: { message: string; type?: string }[];
  statuses: (string | undefined)[];
  compactCalls: number;
  compactOptions: { onComplete?: () => void; onError?: (error: Error) => void }[];
  providerRegistrations: RegisteredProvider[];
  providerUnregistrations: string[];
  setModelCalls: FakeModel[];
  /** The session's selected model, updated by the fake setModel like real Pi state. */
  selection: { model: FakeModel | undefined };
};

type RegistryOptions = {
  /** Config another extension has registered for a provider, keyed by provider id. */
  extensionConfigs?: Map<string, Record<string, unknown>>;
};

function harness(registry: ReturnType<typeof fakeRegistry> | undefined): Recorded {
  const selection: { model: FakeModel | undefined } = { model: undefined };
  const handlers = new Map<string, Handler[]>();
  const commands: { name: string; handler: Handler }[] = [];
  const notifications: { message: string; type?: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const providerRegistrations: RegisteredProvider[] = [];
  const providerUnregistrations: string[] = [];
  const setModelCalls: FakeModel[] = [];
  const pi: FakePi = {
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    },
    registerCommand: (name, options) => {
      commands.push({ name, handler: options.handler });
    },
    registerProvider: (name, config) => {
      providerRegistrations.push({ name, config });
      registry?.register(name, config);
    },
    unregisterProvider: (name) => {
      providerUnregistrations.push(name);
      registry?.unregister(name);
    },
    setModel: (model) => {
      selection.model = model;
      setModelCalls.push(model);
      return Promise.resolve(true);
    },
  };
  return {
    pi,
    handlers,
    commands,
    notifications,
    statuses,
    compactCalls: 0,
    compactOptions: [],
    providerRegistrations,
    providerUnregistrations,
    setModelCalls,
    selection,
  };
}

/** In-memory stand-in for the model registry: registerProvider mutates the live model list. */
function fakeRegistry(models: FakeModel[], registryOptions: RegistryOptions = {}) {
  const originals = [...models];
  const providersWithExtensionConfig = new Set<string>();
  return {
    models,
    getAll: () => models,
    find: (provider: string, id: string) =>
      models.find((model) => model.provider === provider && model.id === id),
    getRegisteredProviderConfig: (provider: string) => {
      if (providersWithExtensionConfig.has(provider)) return { models: [] };
      return registryOptions.extensionConfigs?.get(provider);
    },
    register: (name: string, config: { models?: unknown[] }) => {
      providersWithExtensionConfig.add(name);
      // The real registry stamps each registered model with its provider.
      const incoming = (config.models ?? []).map((model) => {
        const entry = model as FakeModel;
        return { ...entry, provider: name };
      });
      for (const model of incoming) {
        const index = models.findIndex((probe) => probe.provider === name && probe.id === model.id);
        const existing = index === -1 ? undefined : models[index];
        if (existing === undefined) models.push(model);
        else models[index] = model;
      }
    },
    unregister: (name: string) => {
      providersWithExtensionConfig.delete(name);
      for (let index = models.length - 1; index >= 0; index -= 1) {
        if (models[index]?.provider === name) models.splice(index, 1);
      }
      for (const model of originals) {
        if (model.provider === name) models.push(model);
      }
    },
  };
}

function fakeContext(
  recorded: Recorded,
  registry: ReturnType<typeof fakeRegistry> | undefined,
  overrides: {
    tokens?: number | null;
    idle?: boolean;
    pending?: boolean;
    model?: FakeModel | undefined;
  } = {},
): unknown {
  if (overrides.model !== undefined) {
    recorded.selection.model = overrides.model;
  }
  return {
    mode: "tui",
    get model() {
      return recorded.selection.model;
    },
    modelRegistry: registry ?? {
      getAll: () => [],
      find: () => undefined,
      getRegisteredProviderConfig: () => undefined,
    },
    ui: {
      notify: (message: string, type?: string) => {
        recorded.notifications.push(type === undefined ? { message } : { message, type });
      },
      setStatus: (key: string, text: string | undefined) => {
        if (key !== "context-ceiling") throw new Error(`unexpected status key ${key}`);
        recorded.statuses.push(text);
      },
    },
    getContextUsage: () => ({
      tokens: overrides.tokens ?? null,
      contextWindow: 1_000_000,
    }),
    isIdle: () => overrides.idle ?? true,
    hasPendingMessages: () => overrides.pending ?? false,
    compact: (options?: { onComplete?: () => void; onError?: (error: Error) => void }) => {
      recorded.compactCalls += 1;
      if (options) recorded.compactOptions.push(options);
    },
  };
}

function bigModel(overrides: Partial<FakeModel> = {}): FakeModel {
  return {
    type: "chat",
    id: "big-model",
    name: "Big Model",
    api: "anthropic-messages",
    provider: "anthropic",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    ...overrides,
  };
}

async function emit(
  recorded: Recorded,
  event: string,
  ctx: unknown,
  payload: Record<string, unknown> = {},
): Promise<void> {
  for (const handler of recorded.handlers.get(event) ?? []) {
    await handler({ type: event, ...payload }, ctx);
  }
}

describe("context-ceiling extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("registers the lifecycle hooks and the command", () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    expect([...recorded.handlers.keys()].sort()).toEqual([
      "agent_before_settle",
      "agent_settled",
      "model_select",
      "session_shutdown",
      "session_start",
      "turn_end",
    ]);
    expect(recorded.commands.map((command) => command.name)).toEqual(["context-ceiling"]);
  });

  test("waits during a busy run", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const busy = fakeContext(recorded, undefined, { tokens: 273_000, idle: false });
    await emit(recorded, "turn_end", busy);
    expect(recorded.compactCalls).toBe(0);
    expect(recorded.notifications).toEqual([]);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const idle = fakeContext(recorded, undefined, { tokens: 273_000, idle: true });
    await emit(recorded, "agent_settled", idle);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
    expect(recorded.notifications[0]?.message).toContain("— compacting");
    expect(recorded.statuses.at(-1)).toBeUndefined();
  });

  test("skips the scheduled compaction when a settled", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    let idle = true;
    const ctx = fakeContext(recorded, undefined, { tokens: 273_000 });
    (ctx as { isIdle: () => boolean }).isIdle = () => idle;
    await emit(recorded, "agent_settled", ctx);
    idle = false;
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(0);

    idle = true;
    await emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
  });

  test("skips the scheduled compaction while", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, undefined, { tokens: 273_000, idle: true, pending: true });
    await emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(0);
  });

  test("does not re-request while", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, undefined, { tokens: 273_000, idle: true });
    await emit(recorded, "agent_settled", ctx);
    await emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
  });

  test("stays quiet at or below", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const over = fakeContext(recorded, undefined, { tokens: 273_000, idle: false });
    await emit(recorded, "turn_end", over);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const under = fakeContext(recorded, undefined, { tokens: 271_000, idle: false });
    await emit(recorded, "turn_end", under);
    expect(recorded.compactCalls).toBe(0);
    expect(recorded.statuses.at(-1)).toBeUndefined();
  });

  test("reports a failed compaction", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, undefined, { tokens: 273_000, idle: true });
    await emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
    expect(recorded.notifications[0]?.message).toContain("— compacting");

    recorded.compactOptions[0]?.onError?.(new Error("provider unavailable"));
    expect(recorded.notifications.at(-1)?.type).toBe("warning");

    await emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(2);
  });

  test("turning the ceiling off clears the wait status", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const busy = fakeContext(recorded, undefined, { tokens: 273_000, idle: false });
    await emit(recorded, "turn_end", busy);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const command = recorded.commands[0]?.handler;
    const ctx = fakeContext(recorded, undefined);
    await command?.("off", ctx);
    expect(recorded.statuses.at(-1)).toBeUndefined();
    expect(recorded.notifications.at(-1)?.message).toBe("Context ceiling off");
  });
});

describe("context-ceiling window cap", () => {
  test("caps the selected model's provider on session start and re-applies the selection", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });

    await emit(recorded, "session_start", ctx);

    expect(recorded.providerRegistrations).toHaveLength(1);
    const registration = recorded.providerRegistrations[0];
    expect(registration?.name).toBe("anthropic");
    expect(registration?.config.models).toHaveLength(1);
    const capped = registration?.config.models?.[0] as FakeModel | undefined;
    expect(capped?.contextWindow).toBe(272_000 + DEFAULT_RESERVE_TOKENS);

    expect(recorded.setModelCalls).toEqual([registry.find("anthropic", "big-model")]);
    expect(recorded.setModelCalls[0]?.contextWindow).toBe(272_000 + DEFAULT_RESERVE_TOKENS);
  });

  test("leaves providers whose models fit under the cap alone", async () => {
    const selected = bigModel({ contextWindow: 200_000 });
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });

    await emit(recorded, "session_start", ctx);

    expect(recorded.providerRegistrations).toEqual([]);
    expect(recorded.setModelCalls).toEqual([]);
  });

  test("does nothing when no model is selected", async () => {
    const recorded = harness(undefined);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, undefined, { model: undefined });

    await emit(recorded, "session_start", ctx);

    expect(recorded.providerRegistrations).toEqual([]);
    expect(recorded.setModelCalls).toEqual([]);
  });

  test("caps a newly selected provider on model_select", async () => {
    const anthropic = bigModel();
    const other = bigModel({ provider: "google", id: "gemini" });
    const registry = fakeRegistry([anthropic, other]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: anthropic });
    await emit(recorded, "session_start", ctx);

    await emit(recorded, "model_select", ctx, { model: other });

    expect(recorded.providerRegistrations.map((entry) => entry.name)).toEqual([
      "anthropic",
      "google",
    ]);
    expect(recorded.setModelCalls.at(-1)?.provider).toBe("google");
  });

  test("converges when the capped selection re-fires model_select", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });
    await emit(recorded, "session_start", ctx);

    const capped = registry.find("anthropic", "big-model");
    await emit(recorded, "model_select", ctx, { model: capped });

    expect(recorded.providerRegistrations).toHaveLength(1);
    expect(recorded.setModelCalls).toHaveLength(1);
  });

  test("turning the ceiling off restores the original window and selection", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });
    await emit(recorded, "session_start", ctx);

    await recorded.commands[0]?.handler("off", ctx);

    expect(recorded.providerUnregistrations).toEqual(["anthropic"]);
    expect(recorded.setModelCalls.at(-1)?.contextWindow).toBe(1_000_000);
  });

  test("retargeting re-derives the cap from the original window", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });
    await emit(recorded, "session_start", ctx);

    await recorded.commands[0]?.handler("400000", ctx);

    const last = recorded.providerRegistrations.at(-1);
    const capped = last?.config.models?.[0] as FakeModel;
    expect(capped.contextWindow).toBe(400_000 + DEFAULT_RESERVE_TOKENS);
    expect(recorded.setModelCalls.at(-1)?.contextWindow).toBe(400_000 + DEFAULT_RESERVE_TOKENS);
  });

  test("restores a prior extension config instead of unregistering the provider", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected], {
      extensionConfigs: new Map([["anthropic", { models: [] }]]),
    });
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, registry, { model: selected });
    await emit(recorded, "session_start", ctx);

    await recorded.commands[0]?.handler("off", ctx);

    expect(recorded.providerUnregistrations).toEqual([]);
    expect(recorded.providerRegistrations).toHaveLength(2);
    expect(recorded.providerRegistrations.at(-1)?.config).toEqual({ models: [] });
  });

  test("reports a warning when the capped selection cannot be re-applied", async () => {
    const selected = bigModel();
    const registry = fakeRegistry([selected]);
    const recorded = harness(registry);
    contextCeiling(recorded.pi as never);
    recorded.pi.setModel = () => Promise.resolve(false);
    const ctx = fakeContext(recorded, registry, { model: selected });

    await emit(recorded, "session_start", ctx);

    expect(recorded.notifications.at(-1)?.type).toBe("warning");
    expect(recorded.notifications.at(-1)?.message).toContain("could not re-apply");
  });
});
