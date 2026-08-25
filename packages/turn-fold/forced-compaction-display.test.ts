import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import turnFold from "./index.ts";
import { TurnFoldState } from "./turn-state.ts";

const FORCED_COMPACTION_DISPLAY_EVENT = "@onurpi/pi-codex-compaction:forced-compaction-display";
const renderPatchMock = vi.hoisted(() => ({ states: [] as unknown[] }));

vi.mock("./render-patches.ts", () => ({
  installRenderPatches: (state: unknown) => {
    renderPatchMock.states.push(state);
    return () => undefined;
  },
}));

type Handler = (...arguments_: unknown[]) => unknown;

function harness(branch: unknown[] = []) {
  const eventHandlers = new Map<string, (data: unknown) => void>();
  const handlers = new Map<string, Handler>();
  let editorFactory: unknown;
  const pi = {
    appendEntry: vi.fn(),
    events: {
      emit: (channel: string, data: unknown) => eventHandlers.get(channel)?.(data),
      on: (channel: string, handler: (data: unknown) => void) => {
        eventHandlers.set(channel, handler);
        return () => eventHandlers.delete(channel);
      },
    },
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/workspace/project",
    hasPendingMessages: vi.fn(() => false),
    hasUI: true,
    isIdle: vi.fn(() => true),
    mode: "tui",
    sessionManager: {
      buildContextEntries: () => branch,
      getBranch: () => branch,
      getSessionFile: () => "/tmp/turn-fold-forced-compaction.jsonl",
      getSessionId: () => "session-id",
    },
    ui: {
      getEditorComponent: vi.fn(() => editorFactory),
      notify: vi.fn(),
      setEditorComponent: vi.fn((factory: unknown) => {
        editorFactory = factory;
      }),
      setStatus: vi.fn(),
      theme: undefined,
    },
  };
  turnFold(pi);
  const emit = async (event: string, payload: object) => {
    await handlers.get(event)?.(payload, ctx);
  };
  const emitDisplay = (action: "hold" | "release") => {
    eventHandlers.get(FORCED_COMPACTION_DISPLAY_EVENT)?.({ action, sessionId: "session-id" });
  };
  const state = renderPatchMock.states.at(-1);
  if (!(state instanceof TurnFoldState)) throw new Error("Turn Fold state was not installed");
  return { ctx, emit, emitDisplay, state };
}

afterEach(() => {
  renderPatchMock.states.length = 0;
  vi.clearAllMocks();
});

describe("forced Codex compaction display", () => {
  it("keeps the compaction in the run summary across the hidden continuation", async () => {
    const userMessage = { content: "Prompt", role: "user", timestamp: 100 };
    const abortedMessage = {
      content: [{ text: "Working", type: "text" }],
      role: "assistant",
      stopReason: "aborted",
      timestamp: 110,
    };
    const branch: unknown[] = [
      { id: "turn-user", message: userMessage, type: "message" },
      { id: "turn-aborted", message: abortedMessage, type: "message" },
    ];
    const h = harness(branch);

    await h.emit("session_start", { type: "session_start" });
    await h.emit("agent_start", { type: "agent_start" });
    await h.emit("message_start", { message: userMessage });
    await h.emit("message_start", { message: abortedMessage });
    h.emitDisplay("hold");
    await h.emit("message_end", { message: abortedMessage });
    await h.emit("agent_settled", { type: "agent_settled" });
    expect(h.state.hasActive()).toBe(true);

    const compactionEntry = {
      id: "compact-forced",
      timestamp: new Date(120).toISOString(),
      type: "compaction",
    };
    branch.push(compactionEntry);
    await h.emit("session_compact", {
      compactionEntry,
      reason: "manual",
      type: "session_compact",
      willRetry: false,
    });
    const compactionComponent = {};
    h.state.associateCompaction(compactionComponent, {
      role: "compactionSummary",
      timestamp: 120,
    });

    await h.emit("agent_start", { type: "agent_start" });
    const finalMessage = {
      content: [{ text: "Done", type: "text" }],
      role: "assistant",
      timestamp: 140,
    };
    await h.emit("message_start", { message: finalMessage });
    await h.emit("message_end", { message: finalMessage });
    await h.emit("agent_settled", { type: "agent_settled" });

    expect(h.state.hasActive()).toBe(false);
    expect(h.state.viewFor(compactionComponent, 150)).toMatchObject({
      display: "settled-summary",
      summary: { aborted: false, compactions: 1 },
    });
  });

  it("settles the held run when forced compaction cannot continue", async () => {
    const h = harness();
    await h.emit("session_start", { type: "session_start" });
    await h.emit("agent_start", { type: "agent_start" });
    h.emitDisplay("hold");
    await h.emit("agent_settled", { type: "agent_settled" });
    expect(h.state.hasActive()).toBe(true);

    h.emitDisplay("release");
    expect(h.state.hasActive()).toBe(false);
  });

  it("clears a held run when the model changes before continuation", async () => {
    const h = harness();
    await h.emit("session_start", { type: "session_start" });
    await h.emit("agent_start", { type: "agent_start" });
    h.emitDisplay("hold");
    await h.emit("model_select", { type: "model_select" });

    expect(h.state.hasActive()).toBe(false);
  });

  it("lets overflow recovery settle without waiting for a new agent start", async () => {
    const branch: unknown[] = [
      {
        id: "turn-user",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
    ];
    const h = harness(branch);
    await h.emit("session_start", { type: "session_start" });
    await h.emit("agent_start", { type: "agent_start" });
    h.emitDisplay("hold");
    const compactionEntry = {
      id: "compact-overflow",
      timestamp: new Date(120).toISOString(),
      type: "compaction",
    };
    branch.push(compactionEntry);
    await h.emit("session_compact", {
      compactionEntry,
      reason: "overflow",
      type: "session_compact",
      willRetry: true,
    });
    await h.emit("agent_settled", { type: "agent_settled" });

    expect(h.state.hasActive()).toBe(false);
  });
});
