import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import goalExtension from "./index.ts";
import { createGoalState } from "./goal-state.ts";

type Handler = (...arguments_: unknown[]) => unknown;
type ToolDefinition = { execute: Handler; name: string };

type Harness = {
  activeTools: string[];
  appendEntry: ReturnType<typeof vi.fn>;
  commands: ReadonlyMap<string, Handler>;
  handlers: ReadonlyMap<string, Handler>;
  pi: ExtensionAPI;
  sendMessage: ReturnType<typeof vi.fn>;
  tools: ReadonlyMap<string, ToolDefinition>;
};

function harness(): Harness {
  const activeTools = ["read", "create_goal"];
  const appendEntry = vi.fn();
  const commands = new Map<string, Handler>();
  const handlers = new Map<string, Handler>();
  const sendMessage = vi.fn();
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    appendEntry,
    getActiveTools: () => [...activeTools],
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: Handler }) =>
      commands.set(name, definition.handler),
    registerMessageRenderer: () => undefined,
    registerTool: (definition: ToolDefinition) => tools.set(definition.name, definition),
    sendMessage,
    setActiveTools: (names: string[]) => {
      activeTools.splice(0, activeTools.length, ...names);
    },
  } as unknown as ExtensionAPI;
  return { activeTools, appendEntry, commands, handlers, pi, sendMessage, tools };
}

function context(branch: unknown[] = []) {
  return {
    hasPendingMessages: vi.fn(() => false),
    isIdle: vi.fn(() => true),
    sessionManager: {
      getBranch: () => branch,
    },
    ui: {
      confirm: vi.fn(() => Promise.resolve(true)),
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  };
}

function emit(
  handlers: ReadonlyMap<string, Handler>,
  event: string,
  payload: object,
  ctx: object,
): Promise<unknown> {
  return Promise.resolve(handlers.get(event)?.(payload, ctx));
}

async function command(
  commands: ReadonlyMap<string, Handler>,
  args: string,
  ctx: object,
): Promise<void> {
  await commands.get("goal")?.(args, ctx);
}

async function settledRun(
  extension: Harness,
  ctx: object,
  messages: readonly unknown[],
): Promise<void> {
  await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);
  await emit(
    extension.handlers,
    "turn_end",
    {
      message: { role: "assistant", usage: { totalTokens: 10 } },
      toolResults: [],
      type: "turn_end",
    },
    ctx,
  );
  await emit(extension.handlers, "agent_end", { messages, type: "agent_end" }, ctx);
  await emit(extension.handlers, "agent_settled", { type: "agent_settled" }, ctx);
  await Promise.resolve();
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function mockArgument(
  mock: ReturnType<typeof vi.fn>,
  callIndex: number,
  argumentIndex: number,
): unknown {
  const call: unknown = mock.mock.calls.at(callIndex);
  return Array.isArray(call) ? (call[argumentIndex] as unknown) : undefined;
}

function latestPersistedGoal(extension: Harness): unknown {
  return field(mockArgument(extension.appendEntry, -1, 1), "goal");
}

function sentKinds(extension: Harness): unknown[] {
  return extension.sendMessage.mock.calls.map((_call, index) =>
    field(field(mockArgument(extension.sendMessage, index, 0), "details"), "kind"),
  );
}

describe("Goal extension lifecycle", () => {
  it("registers the upstream commands and tools", () => {
    const extension = harness();
    goalExtension(extension.pi);

    expect(extension.commands.has("goal")).toBe(true);
    expect([...extension.tools.keys()]).toEqual(["get_goal", "create_goal", "update_goal"]);
  });

  it("starts a goal and injects its objective through before_agent_start", async () => {
    const extension = harness();
    const ctx = context();
    goalExtension(extension.pi);

    await command(extension.commands, "ship verified code", ctx);

    expect(extension.appendEntry).toHaveBeenCalledTimes(1);
    const sentMessage = mockArgument(extension.sendMessage, 0, 0);
    expect(field(sentMessage, "customType")).toBe("pi-goal-event");
    expect(field(sentMessage, "content")).not.toContain("ship verified code");
    expect(mockArgument(extension.sendMessage, 0, 1)).toEqual({ triggerTurn: true });
    const result = await emit(
      extension.handlers,
      "before_agent_start",
      { systemPrompt: "base", type: "before_agent_start" },
      ctx,
    );
    expect(field(result, "systemPrompt")).toContain("ship verified code");
  });

  it("accounts and continues only after agent_settled", async () => {
    const extension = harness();
    const ctx = context();
    goalExtension(extension.pi);
    await command(extension.commands, "ship it", ctx);
    extension.appendEntry.mockClear();
    extension.sendMessage.mockClear();

    await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);
    await emit(
      extension.handlers,
      "turn_end",
      { message: { role: "assistant", usage: { totalTokens: 12 } }, toolResults: [] },
      ctx,
    );
    await emit(
      extension.handlers,
      "agent_end",
      {
        messages: [
          { content: [{ text: "working", type: "text" }], role: "assistant", stopReason: "stop" },
        ],
      },
      ctx,
    );

    expect(extension.appendEntry).not.toHaveBeenCalled();
    expect(extension.sendMessage).not.toHaveBeenCalled();

    await emit(extension.handlers, "agent_settled", { type: "agent_settled" }, ctx);
    await Promise.resolve();

    expect(extension.appendEntry).toHaveBeenCalledTimes(1);
    expect(latestPersistedGoal(extension)).toMatchObject({
      safety: { automaticRunCount: 1, checkpointRunCount: 1 },
      tokensUsed: 12,
    });
    expect(sentKinds(extension)).toEqual(["continuation"]);
    expect(mockArgument(extension.sendMessage, 0, 1)).toEqual({ triggerTurn: true });
  });

  it("pauses after three repeated settled outcomes", async () => {
    const extension = harness();
    const ctx = context();
    goalExtension(extension.pi);
    await command(extension.commands, "ship it", ctx);
    extension.sendMessage.mockClear();

    const messages = [
      {
        content: [{ text: "I repeated the same work", type: "text" }],
        role: "assistant",
        stopReason: "stop",
      },
    ];
    for (let run = 0; run < 3; run += 1) await settledRun(extension, ctx, messages);

    expect(latestPersistedGoal(extension)).toMatchObject({
      safety: {
        automaticRunCount: 3,
        pause: { cycleLength: 1, reason: "repeated_cycle", repetitions: 3 },
      },
      status: "paused",
    });
    expect(sentKinds(extension)).toEqual(["continuation", "continuation", "paused"]);
  });

  it("pauses restored active goals without silently continuing", async () => {
    const active = createGoalState("restored", null, 42, 0.5);
    const branch = [{ customType: "pi-goal", data: { goal: active }, id: "state", type: "custom" }];
    const extension = harness();
    const ctx = context(branch);
    goalExtension(extension.pi);

    await emit(
      extension.handlers,
      "session_start",
      { reason: "startup", type: "session_start" },
      ctx,
    );

    expect(latestPersistedGoal(extension)).toMatchObject({
      safety: { pause: { reason: "reload" } },
      status: "paused",
    });
    expect(extension.sendMessage).not.toHaveBeenCalled();
    expect(mockArgument(ctx.ui.notify, 0, 0)).toContain("paused after startup");
    expect(mockArgument(ctx.ui.notify, 0, 1)).toBe("info");
  });

  it("drops active runtime state during session shutdown", async () => {
    const extension = harness();
    const ctx = context();
    goalExtension(extension.pi);
    await command(extension.commands, "ship it", ctx);

    await emit(
      extension.handlers,
      "session_shutdown",
      { reason: "resume", type: "session_shutdown" },
      ctx,
    );
    const result = await emit(
      extension.handlers,
      "before_agent_start",
      { systemPrompt: "base", type: "before_agent_start" },
      ctx,
    );

    expect(result).toBeUndefined();
  });

  it("accounts final usage after update_goal completes mid-run", async () => {
    const extension = harness();
    const ctx = context();
    goalExtension(extension.pi);
    await command(extension.commands, "ship it", ctx);
    await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);

    const update = extension.tools.get("update_goal");
    await update?.execute("tool", { status: "complete" }, undefined, undefined, ctx);
    await emit(
      extension.handlers,
      "turn_end",
      { message: { role: "assistant", usage: { totalTokens: 25 } }, toolResults: [] },
      ctx,
    );
    await emit(
      extension.handlers,
      "agent_end",
      { messages: [{ role: "assistant", stopReason: "stop" }] },
      ctx,
    );
    await emit(extension.handlers, "agent_settled", { type: "agent_settled" }, ctx);

    expect(latestPersistedGoal(extension)).toMatchObject({ status: "complete", tokensUsed: 25 });
  });
});
