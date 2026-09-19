import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import turnFold, { supportsPiVersion } from "./index.ts";
import { clearRestartMarker } from "./restart-marker.ts";
import { parseRunBoundary, TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import { context, emit, entryId, extensionHarness, runTurnFoldCommand } from "./test-support.ts";
import { TurnFoldState } from "./turn-state.ts";

const renderPatchMock = vi.hoisted(() => ({ states: [] as unknown[] }));
const historyViewerMock = vi.hoisted(() => ({
  closes: [] as ReturnType<typeof vi.fn>[],
  defer: false,
  entries: [] as (readonly unknown[])[],
}));

vi.mock("./history-viewer.ts", () => ({
  showHistoryExplorer: (
    _ctx: unknown,
    entries: readonly unknown[],
    lifecycle?: { closed: () => void; opened: (close: () => void) => void },
  ) => {
    historyViewerMock.entries.push(entries);
    if (!historyViewerMock.defer) {
      lifecycle?.opened(() => undefined);
      lifecycle?.closed();
      return Promise.resolve();
    }
    return new Promise<void>((resolvePromise) => {
      const close = vi.fn(() => {
        lifecycle?.closed();
        resolvePromise();
      });
      historyViewerMock.closes.push(close);
      lifecycle?.opened(close);
    });
  },
}));

vi.mock("./render-patches.ts", () => ({
  installRenderPatches: (state: unknown) => {
    renderPatchMock.states.push(state);
    return () => undefined;
  },
}));

afterEach(() => {
  clearRestartMarker();
  renderPatchMock.states.length = 0;
  historyViewerMock.closes.length = 0;
  historyViewerMock.defer = false;
  historyViewerMock.entries.length = 0;
  vi.clearAllMocks();
});

describe("Turn Fold Pi compatibility", () => {
  it.each(["0.84.3", "0.84.99", "0.85.0", "0.100.0", "1.0.0", "12.34.56"])(
    "supports stable future release %s",
    (version) => {
      expect(supportsPiVersion(version)).toBe(true);
    },
  );

  it.each(["0.84.2", "0.83.99", "0.84.4-beta.1", "1.0.0-rc.1", "invalid"])(
    "rejects unsupported release %s",
    (version) => {
      expect(supportsPiVersion(version)).toBe(false);
    },
  );
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
      "turn_end",
      {
        toolResults: [
          {
            details: {
              patch:
                "--- src/example.ts\n+++ src/example.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+added\n",
            },
            isError: false,
            role: "toolResult",
            toolCallId: "edit-final",
            toolName: "edit",
          },
        ],
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
      fileDiffs: [
        {
          additions: 2,
          deletions: 1,
          path: resolve("/workspace/project/src/example.ts"),
        },
      ],
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

describe("Turn Fold persisted run boundaries", () => {
  it("writes one compact marker after the first settled turn and not for retries", async () => {
    const extension = extensionHarness();
    const branch: unknown[] = [];
    const ctx = context([], branch);
    turnFold(extension.pi);

    await emit(
      extension.handlers,
      "session_start",
      { reason: "startup", type: "session_start" },
      ctx,
    );
    await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);
    await emit(
      extension.handlers,
      "message_start",
      { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message_start" },
      ctx,
    );
    branch.push(
      {
        id: "prompt",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
      {
        id: "answer",
        message: { content: [{ text: "Done", type: "text" }], role: "assistant", timestamp: 110 },
        type: "message",
      },
    );
    await emit(extension.handlers, "turn_end", { toolResults: [], type: "turn_end" }, ctx);

    expect(extension.appendEntry).toHaveBeenCalledTimes(1);
    expect(extension.appendEntry.mock.calls[0]?.[0]).toBe(TURN_FOLD_RUN_ENTRY);
    const boundaryData: unknown = extension.appendEntry.mock.calls[0]?.[1];
    expect(parseRunBoundary(boundaryData)).toMatchObject({
      promptEntryId: "prompt",
      version: 1,
    });

    await emit(extension.handlers, "agent_start", { type: "agent_start" }, ctx);
    await emit(extension.handlers, "turn_end", { toolResults: [], type: "turn_end" }, ctx);
    expect(extension.appendEntry).toHaveBeenCalledTimes(1);
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
    state.applyHistoryProjection(otherBranch, otherBranch);
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

describe("Turn Fold TUI isolation", () => {
  it("installs and restores the TUI keyboard editor wrapper", async () => {
    const extension = extensionHarness();
    const ctx = context();
    turnFold(extension.pi);

    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);
    expect(ctx.ui.getEditorComponent()).toBeTypeOf("function");

    await emit(
      extension.handlers,
      "session_shutdown",
      { reason: "quit", type: "session_shutdown" },
      ctx,
    );
    expect(ctx.ui.getEditorComponent()).toBeUndefined();
  });
});

describe("Turn Fold configuration commands", () => {
  it("opens virtual history from the complete active branch", async () => {
    const extension = extensionHarness();
    const branch = [
      { id: "user", message: { content: "Prompt", role: "user" }, type: "message" },
      {
        id: "hidden",
        message: { content: [], role: "assistant", timestamp: 1 },
        type: "message",
      },
      { id: "final", message: { content: [], role: "assistant", timestamp: 2 }, type: "message" },
    ];
    const ctx = context([], branch);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "history", ctx);

    expect(historyViewerMock.entries).toHaveLength(1);
    expect(historyViewerMock.entries[0]?.map(entryId)).toEqual(["user", "hidden", "final"]);
  });

  it("opens history without persistence or restart and closes it on shutdown", async () => {
    const extension = extensionHarness();
    const branch = [{ id: "user", message: { content: "Prompt", role: "user" }, type: "message" }];
    const ctx = context([], branch);
    historyViewerMock.defer = true;
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    const opening = runTurnFoldCommand(extension.commands, "", ctx);
    await Promise.resolve();

    expect(extension.appendEntry).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("restart required"),
      expect.anything(),
    );
    expect(historyViewerMock.closes).toHaveLength(1);

    await emit(
      extension.handlers,
      "session_shutdown",
      { reason: "quit", type: "session_shutdown" },
      ctx,
    );
    await opening;
    expect(historyViewerMock.closes[0]).toHaveBeenCalledOnce();
  });

  it("rejects non-TUI history before waiting for an active response", async () => {
    const extension = extensionHarness();
    const ctx = context();
    ctx.mode = "rpc";
    turnFold(extension.pi);

    await runTurnFoldCommand(extension.commands, "history", ctx);

    expect(ctx.waitForIdle).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Turn Fold history is available only in TUI mode.",
      "warning",
    );
    expect(historyViewerMock.entries).toHaveLength(0);
  });

  it("keeps explorer history independent from the compact transcript scope", async () => {
    const extension = extensionHarness();
    const branch = [
      { id: "before", message: { content: "Old", role: "user" }, type: "message" },
      {
        firstKeptEntryId: "after",
        id: "compaction",
        summary: "Summary",
        tokensBefore: 100,
        type: "compaction",
      },
      { id: "after", message: { content: "New", role: "user" }, type: "message" },
      {
        customType: "onurpi-turn-fold-config",
        data: { preCompaction: "hide", windows: "all" },
        id: "configuration",
        type: "custom",
      },
    ];
    const ctx = context([], branch);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "history", ctx);

    expect(historyViewerMock.entries.at(-1)?.map(entryId)).toEqual([
      "before",
      "compaction",
      "after",
      "configuration",
    ]);
  });
});

describe("Turn Fold projection transitions", () => {
  it("hides loaded pre-compaction history in place", async () => {
    const extension = extensionHarness();
    const branch = [
      { id: "before", message: { content: "Before", role: "user", timestamp: 1 }, type: "message" },
      { id: "latest", type: "compaction" },
      { id: "after", message: { content: "After", role: "user", timestamp: 2 }, type: "message" },
    ];
    const ctx = context(branch, branch);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "pre-compaction hide", ctx);

    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      preCompaction: "hide",
      windows: "all",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Turn fold: compact, pre-compaction hide, windows all",
      "info",
    );
  });
});

describe("Turn Fold widening commands", () => {
  it("requires a restart when showing pre-compaction entries that are not loaded", async () => {
    const extension = extensionHarness();
    const config = {
      customType: "onurpi-turn-fold-config",
      data: { preCompaction: "hide", windows: "all" },
      id: "config",
      type: "custom",
    };
    const before = { id: "before", message: { content: "Before", role: "user" }, type: "message" };
    const latest = { id: "latest", type: "compaction" };
    const after = { id: "after", message: { content: "After", role: "user" }, type: "message" };
    const ctx = context([latest, after, config], [before, latest, after, config]);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "pre-compaction show", ctx);
    await runTurnFoldCommand(extension.commands, "status", ctx);

    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      preCompaction: "show",
      windows: "all",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Turn fold: compact, pre-compaction show, windows all (restart required)",
      "info",
    );
  });
});

describe("Turn Fold relative and in-memory windows", () => {
  it("resolves relative windows after the active response settles", async () => {
    const extension = extensionHarness();
    const branch = [
      { id: "user", message: { content: "Prompt", role: "user" }, type: "message" },
      { id: "first-compaction", type: "compaction" },
      { id: "after", message: { content: "After", role: "user" }, type: "message" },
    ];
    const ctx = context(branch, branch);
    let firstWait = true;
    ctx.waitForIdle.mockImplementation(() => {
      if (firstWait) branch.push({ id: "settled-compaction", type: "compaction" });
      firstWait = false;
      return Promise.resolve();
    });
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows -1", ctx);

    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      preCompaction: "show",
      windows: 2,
    });
  });

  it("confirms an all-windows request when changing from a numeric value", async () => {
    const extension = extensionHarness();
    const config = {
      customType: "onurpi-turn-fold-config",
      data: { preCompaction: "show", windows: 1 },
      id: "config",
      type: "custom",
    };
    const branch = [
      { id: "before", message: { role: "user" }, type: "message" },
      { id: "older", type: "compaction" },
      { id: "between", message: { role: "user" }, type: "message" },
      { id: "latest", type: "compaction" },
      { id: "after", message: { role: "user" }, type: "message" },
      config,
    ];
    const ctx = context([branch[3], branch[4], config], branch);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows all", ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Load full transcript?",
      expect.stringContaining("6 active-branch entries"),
    );
    expect(extension.appendEntry).toHaveBeenCalledWith("onurpi-turn-fold-config", {
      preCompaction: "show",
      windows: "all",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("restart required"),
      "warning",
    );
  });
});

describe("Turn Fold configuration reporting", () => {
  it("leaves the numeric window value unchanged when all is cancelled", async () => {
    const extension = extensionHarness();
    const config = {
      customType: "onurpi-turn-fold-config",
      data: { preCompaction: "show", windows: 1 },
      id: "config",
      type: "custom",
    };
    const ctx = context([config], [config]);
    ctx.ui.confirm.mockResolvedValue(false);
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "windows all", ctx);

    expect(extension.appendEntry).not.toHaveBeenCalled();
  });

  it("reports the requested configuration and validates arguments", async () => {
    const extension = extensionHarness();
    const ctx = context();
    turnFold(extension.pi);
    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    await runTurnFoldCommand(extension.commands, "status", ctx);
    await runTurnFoldCommand(extension.commands, "pre-compaction", ctx);
    await runTurnFoldCommand(extension.commands, "pre-compaction nope", ctx);
    await runTurnFoldCommand(extension.commands, "windows nope", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Turn fold: compact, pre-compaction show, windows all",
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Pre-compaction messages: show", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Use show, hide, or toggle.", "warning");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Use a positive number, +N, -N, all, or reset.",
      "warning",
    );
    expect(extension.completions.get("turn-fold")?.("pre-compaction h")).toContainEqual({
      label: "hide",
      value: "pre-compaction hide",
    });
    expect(extension.completions.get("turn-fold")?.("windows a")).toContainEqual({
      label: "all",
      value: "windows all",
    });
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
    secondContext.sessionManager.buildContextEntries();

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
