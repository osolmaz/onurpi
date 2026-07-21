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

function extensionHarness(): {
  appendEntry: ReturnType<typeof vi.fn>;
  handlers: ReadonlyMap<string, Handler>;
  pi: ExtensionAPI;
} {
  const handlers = new Map<string, Handler>();
  const appendEntry = vi.fn();
  const pi = {
    appendEntry,
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
  } as unknown as ExtensionAPI;
  return { appendEntry, handlers, pi };
}

function context(
  entries: readonly unknown[] = [],
  branch: readonly unknown[] = entries,
  sessionFile = "/tmp/turn-fold-session.jsonl",
) {
  return {
    sessionManager: {
      buildContextEntries: () => entries,
      getBranch: () => branch,
      getSessionFile: () => sessionFile,
      getSessionId: () => "session-id",
    },
    ui: { theme: undefined },
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

afterEach(() => {
  renderPatchMock.states.length = 0;
  vi.clearAllMocks();
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
