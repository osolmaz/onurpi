import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import turnFold from "./index.ts";
import { TurnFoldState } from "./turn-state.ts";

const renderPatchMock = vi.hoisted(() => ({ states: [] as unknown[] }));

vi.mock("./render-patches.ts", () => ({
  installRenderPatches: (state: unknown) => {
    renderPatchMock.states.push(state);
    return () => undefined;
  },
}));

type Handler = (...arguments_: unknown[]) => unknown;

function entryId(entry: unknown): unknown {
  return typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined;
}

function extensionHarness(): {
  appendEntry: ReturnType<typeof vi.fn>;
  commands: ReadonlyMap<string, Handler>;
  handlers: ReadonlyMap<string, Handler>;
  pi: ExtensionAPI;
} {
  const commands = new Map<string, Handler>();
  const handlers = new Map<string, Handler>();
  const appendEntry = vi.fn();
  const pi = {
    appendEntry,
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: Handler }) =>
      commands.set(name, definition.handler),
    registerShortcut: () => undefined,
  } as unknown as ExtensionAPI;
  return { appendEntry, commands, handlers, pi };
}

function context(
  entries: readonly unknown[] = [],
  branch: readonly unknown[] = entries,
  sessionFile = "/tmp/turn-fold-session.jsonl",
) {
  return {
    hasUI: true,
    reload: vi.fn(() => Promise.resolve()),
    sessionManager: {
      buildContextEntries: () => entries,
      getBranch: () => branch,
      getSessionFile: () => sessionFile,
      getSessionId: () => "session-id",
    },
    ui: {
      confirm: vi.fn(() => Promise.resolve(true)),
      notify: vi.fn(),
      select: vi.fn(() => Promise.resolve(undefined)),
      theme: undefined,
    },
    waitForIdle: vi.fn(() => Promise.resolve()),
  };
}

async function emit(
  handlers: ReadonlyMap<string, Handler>,
  event: string,
  payload: object,
  ctx: object,
): Promise<void> {
  await handlers.get(event)?.(payload, ctx);
}

async function runTurnFoldCommand(
  commands: ReadonlyMap<string, Handler>,
  argument: string,
  ctx: object,
): Promise<void> {
  const handler = commands.get("turn-fold");
  if (!handler) throw new Error("Turn Fold command was not registered");
  await handler(argument, ctx);
}

afterEach(() => {
  renderPatchMock.states.length = 0;
  vi.clearAllMocks();
});

describe("Turn Fold finalized edit results", () => {
  it("adds finalized edit patches to the active turn summary", async () => {
    const extension = extensionHarness();
    const ctx = context();
    const toolCaller = {
      content: [{ id: "edit-final", name: "edit", type: "toolCall" }],
      role: "assistant",
      timestamp: 110,
    };
    const finalMessage = {
      content: [{ text: "Done", type: "text" }],
      role: "assistant",
      timestamp: 140,
    };
    turnFold(extension.pi);

    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);
    await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);
    await emit(
      extension.handlers,
      "message_start",
      { message: { content: "Prompt", role: "user", timestamp: 100 } },
      ctx,
    );
    await emit(extension.handlers, "message_start", { message: toolCaller }, ctx);
    await emit(extension.handlers, "message_end", { message: toolCaller }, ctx);
    await emit(
      extension.handlers,
      "message_end",
      {
        message: {
          details: {
            patch: "--- src/example.ts\n+++ src/example.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+added\n",
          },
          isError: false,
          role: "toolResult",
          toolCallId: "edit-final",
          toolName: "edit",
        },
      },
      ctx,
    );
    await emit(extension.handlers, "message_start", { message: finalMessage }, ctx);
    await emit(extension.handlers, "message_end", { message: finalMessage }, ctx);
    await emit(extension.handlers, "agent_settled", { type: "agent_settled" }, ctx);

    const state = renderPatchMock.states.at(-1);
    expect(state).toBeInstanceOf(TurnFoldState);
    if (!(state instanceof TurnFoldState)) throw new Error("Turn Fold state was not installed");
    const final = {};
    state.associateAssistant(final, finalMessage);
    expect(state.viewFor(final)?.summary.fileDiff).toEqual({
      additions: 2,
      deletions: 1,
      files: 1,
    });
  });
});

describe("Turn Fold extension compaction state", () => {
  it("does not append Pi session entries for automatic compactions", async () => {
    const { appendEntry, handlers, pi } = extensionHarness();
    const ctx = context(
      [],
      [
        {
          id: "turn-user",
          message: { content: "Prompt", role: "user", timestamp: 100 },
          type: "message",
        },
        { id: "compact-1", type: "compaction" },
      ],
    );
    turnFold(pi);

    await emit(handlers, "session_start", { reason: "startup", type: "session_start" }, ctx);
    await emit(handlers, "agent_start", { type: "agent_start" }, ctx);
    await emit(
      handlers,
      "message_start",
      { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message_start" },
      ctx,
    );
    await emit(
      handlers,
      "session_compact",
      {
        compactionEntry: {
          id: "compact-1",
          timestamp: new Date(120).toISOString(),
          type: "compaction",
        },
        reason: "threshold",
        type: "session_compact",
      },
      ctx,
    );

    expect(appendEntry).not.toHaveBeenCalled();
    await emit(handlers, "session_shutdown", { reason: "quit", type: "session_shutdown" }, ctx);
  });
});

describe("Turn Fold ephemeral compaction lifecycle", () => {
  it("drops an association when tree navigation leaves its compaction branch", async () => {
    const extension = extensionHarness();
    const branchWithCompaction = [
      {
        id: "turn-user",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
      { id: "compact-branch", type: "compaction" },
    ];
    const firstContext = context([], branchWithCompaction);
    turnFold(extension.pi);
    await emit(
      extension.handlers,
      "session_start",
      { reason: "startup", type: "session_start" },
      firstContext,
    );
    await emit(extension.handlers, "agent_start", { type: "agent_start" }, firstContext);
    await emit(
      extension.handlers,
      "message_start",
      { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message_start" },
      firstContext,
    );
    await emit(
      extension.handlers,
      "session_compact",
      {
        compactionEntry: {
          id: "compact-branch",
          timestamp: new Date(120).toISOString(),
          type: "compaction",
        },
        reason: "threshold",
        type: "session_compact",
      },
      firstContext,
    );
    await emit(extension.handlers, "agent_settled", { type: "agent_settled" }, firstContext);

    const otherBranch = [
      {
        id: "turn-user",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
      {
        id: "other-assistant",
        message: {
          content: [{ text: "Other branch", type: "text" }],
          role: "assistant",
          timestamp: 140,
        },
        type: "message",
      },
    ];
    const secondContext = context(otherBranch, otherBranch);
    await emit(extension.handlers, "session_tree", { type: "session_tree" }, secondContext);

    const state = renderPatchMock.states.at(-1);
    expect(state).toBeInstanceOf(TurnFoldState);
    if (!(state instanceof TurnFoldState)) throw new Error("Turn Fold state was not installed");
    const staleCompaction = {};
    state.reloadHistoryForNewComponent(staleCompaction);
    state.associateCompaction(staleCompaction, {
      role: "compactionSummary",
      timestamp: 120,
    });
    expect(state.viewFor(staleCompaction)).toBeUndefined();

    await emit(
      extension.handlers,
      "session_shutdown",
      { reason: "quit", type: "session_shutdown" },
      secondContext,
    );
  });
});

describe("Turn Fold window commands", () => {
  it("persists relative changes and reloads the main transcript", async () => {
    const extension = extensionHarness();
    const ctx = context([
      { id: "user", message: { content: "Prompt", role: "user" }, type: "message" },
      { id: "compact", type: "compaction" },
    ]);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows +2", ctx);

    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      mode: "compact",
      windows: 5,
    });
    expect(ctx.waitForIdle).toHaveBeenCalledTimes(2);
    expect(ctx.reload).toHaveBeenCalledOnce();
  });

  it("confirms full replay and leaves state unchanged when cancelled", async () => {
    const extension = extensionHarness();
    const ctx = context([{ id: "user", message: { role: "user" }, type: "message" }]);
    ctx.ui.confirm.mockResolvedValue(false);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows all", ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Load full transcript?",
      expect.stringContaining("1 active-branch entries"),
    );
    expect(extension.appendEntry).not.toHaveBeenCalled();
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it("persists confirmed full replay and reloads", async () => {
    const extension = extensionHarness();
    const ctx = context([{ id: "user", message: { role: "user" }, type: "message" }]);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows all", ctx);

    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      mode: "compact",
      windows: "all",
    });
    expect(ctx.reload).toHaveBeenCalledOnce();
  });

  it("reports status and invalid window values without reloading", async () => {
    const extension = extensionHarness();
    const ctx = context();
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "status", ctx);
    await runTurnFoldCommand(extension.commands, "windows nope", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Turn fold: compact, windows 3", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Use a positive number, +N, -N, all, or reset.",
      "warning",
    );
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it("loads the default bounded range into Pi's main transcript", async () => {
    const extension = extensionHarness();
    const branch = [
      { id: "u0", message: { role: "user" }, type: "message" },
      { id: "c1", type: "compaction" },
      { id: "u1", message: { role: "user" }, type: "message" },
      { id: "c2", type: "compaction" },
      { id: "u2", message: { role: "user" }, type: "message" },
      { id: "c3", type: "compaction" },
      { id: "u3", message: { role: "user" }, type: "message" },
      { id: "c4", type: "compaction" },
      { id: "now", type: "custom" },
    ];
    const ctx = context([], branch);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    expect(ctx.sessionManager.buildContextEntries().map(entryId)).toEqual([
      "u1",
      "c2",
      "u2",
      "c3",
      "u3",
      "c4",
      "now",
    ]);
  });
});

describe("Turn Fold extension reload", () => {
  it("restores an automatic compaction association after extension reload", async () => {
    const first = extensionHarness();
    const finalMessage = {
      content: [{ text: "Done", type: "text" }],
      role: "assistant",
      timestamp: 140,
    };
    const branch = [
      {
        id: "turn-user",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
      { id: "kept-assistant", message: finalMessage, type: "message" },
      { id: "compact-reload", type: "compaction" },
    ];
    const firstContext = context([], branch);
    turnFold(first.pi);
    await emit(
      first.handlers,
      "session_start",
      { reason: "startup", type: "session_start" },
      firstContext,
    );
    await emit(first.handlers, "agent_start", { type: "agent_start" }, firstContext);
    await emit(
      first.handlers,
      "message_start",
      { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message_start" },
      firstContext,
    );
    await emit(
      first.handlers,
      "session_compact",
      {
        compactionEntry: {
          id: "compact-reload",
          timestamp: new Date(120).toISOString(),
          type: "compaction",
        },
        reason: "threshold",
        type: "session_compact",
      },
      firstContext,
    );
    await emit(
      first.handlers,
      "session_shutdown",
      { reason: "reload", type: "session_shutdown" },
      firstContext,
    );

    const secondContext = context(
      [
        {
          id: "compact-reload",
          timestamp: new Date(120).toISOString(),
          type: "compaction",
        },
        { id: "kept-assistant", message: finalMessage, type: "message" },
      ],
      branch,
    );
    const second = extensionHarness();
    turnFold(second.pi);
    await emit(
      second.handlers,
      "session_start",
      { reason: "reload", type: "session_start" },
      secondContext,
    );

    const state = renderPatchMock.states.at(-1);
    expect(state).toBeInstanceOf(TurnFoldState);
    if (!(state instanceof TurnFoldState)) throw new Error("Turn Fold state was not installed");
    const compaction = {};
    const final = {};
    state.associateCompaction(compaction, { role: "compactionSummary", timestamp: 120 });
    state.associateAssistant(final, finalMessage);
    expect(state.viewFor(compaction)).toMatchObject({ summary: { compactions: 1 } });
    expect(state.viewFor(final)?.display).toBe("settled-final");

    await emit(
      second.handlers,
      "session_shutdown",
      { reason: "quit", type: "session_shutdown" },
      secondContext,
    );
  });
});
