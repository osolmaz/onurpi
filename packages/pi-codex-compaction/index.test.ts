import type { CustomEntry, EntryRenderer, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import codexCompactionExtension from "./index.ts";
import { COMPACTION_STATUS_KIND, type CompactionStatus } from "./codex-compaction.ts";

type Handler = (...args: never[]) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const renderers = new Map<string, EntryRenderer<CompactionStatus>>();
  const sentMessages: unknown[] = [];
  const emittedEvents: string[] = [];
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerEntryRenderer: (customType: string, renderer: EntryRenderer<CompactionStatus>) =>
      renderers.set(customType, renderer),
    appendEntry: () => undefined,
    events: {
      emit: (channel: string) => {
        emittedEvents.push(channel);
      },
    },
    sendMessage: (message: unknown) => {
      sentMessages.push(message);
    },
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  return { pi, handlers, renderers, sentMessages, emittedEvents };
}

function statusEntry(data: CompactionStatus): CustomEntry<CompactionStatus> {
  return {
    type: "custom",
    id: "status-1",
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: COMPACTION_STATUS_KIND,
    data,
  };
}

const fakeTheme = { fg: (_color: string, text: string) => text };

describe("pi-codex-compaction extension factory", () => {
  it("registers all lifecycle handlers and the status renderer", () => {
    const { pi, handlers, renderers } = fakePi();
    codexCompactionExtension(pi);

    expect([...handlers.keys()].sort()).toEqual([
      "before_provider_headers",
      "before_provider_request",
      "context",
      "model_select",
      "session_before_compact",
      "session_shutdown",
      "session_start",
    ]);
    // No turn_end/agent_settled/session_compact handlers: the extension never aborts,
    // force-compacts, or sends continuation messages on its own.
    expect(handlers.has("turn_end")).toBe(false);
    expect(handlers.has("agent_settled")).toBe(false);
    expect(handlers.has("session_compact")).toBe(false);
    expect(renderers.has(COMPACTION_STATUS_KIND)).toBe(true);
  });

  it("never wires continuation messages or a forced display event", () => {
    const { pi, handlers, sentMessages, emittedEvents } = fakePi();
    codexCompactionExtension(pi);

    // Drive every registered handler far enough to surface hidden continuation wiring.
    const ctx = {
      model: undefined,
      sessionManager: { getSessionId: () => "s", getBranch: () => [] },
    };
    for (const handler of handlers.values()) {
      void handler({ headers: {}, payload: undefined } as never, ctx as never);
    }
    expect(sentMessages).toEqual([]);
    expect(emittedEvents).toEqual([]);
  });

  it("renders running, complete, and failed status entries", () => {
    const { pi, renderers } = fakePi();
    codexCompactionExtension(pi);
    const renderer = renderers.get(COMPACTION_STATUS_KIND);
    if (!renderer) throw new Error("Status renderer was not registered");

    const options = {} as Parameters<EntryRenderer<CompactionStatus>>[1];
    const theme = fakeTheme as Parameters<EntryRenderer<CompactionStatus>>[2];
    const running = renderer(
      statusEntry({ operationId: "operation-1", state: "running" }),
      options,
      theme,
    );
    const complete = renderer(
      statusEntry({ operationId: "operation-1", state: "complete" }),
      options,
      theme,
    );
    const failed = renderer(
      statusEntry({ operationId: "operation-1", state: "failed", error: "boom" }),
      options,
      theme,
    );

    expect(running?.render(80).join("\n")).toContain("compaction running");
    expect(complete?.render(80).join("\n")).toContain("compaction complete");
    expect(failed?.render(80).join("\n")).toContain("compaction failed: boom");
  });
});
