import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import contextWindowPolicy from "./index.ts";

type Handler = (...args: unknown[]) => unknown;

function fakePi(): { handlers: Map<string, Handler>; pi: ExtensionAPI; sent: unknown[] } {
  const handlers = new Map<string, Handler>();
  const sent: unknown[] = [];
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    sendMessage: (message: unknown, options: unknown) => {
      sent.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  return { handlers, pi, sent };
}

describe("context-window-policy extension", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers only documented lifecycle hooks", () => {
    const { handlers, pi } = fakePi();
    contextWindowPolicy(pi);

    expect([...handlers.keys()].sort()).toEqual([
      "agent_settled",
      "model_select",
      "session_compact",
      "session_shutdown",
      "session_start",
      "turn_end",
    ]);
  });

  it("waits until the next timer turn before compacting", () => {
    vi.useFakeTimers();
    const { handlers, pi } = fakePi();
    const compact = vi.fn();
    const ctx = {
      compact,
      getContextUsage: () => ({ contextWindow: 272_000, percent: 90, tokens: 244_800 }),
      hasPendingMessages: () => false,
      hasUI: false,
      isIdle: () => true,
      model: {
        api: "openai-codex-responses",
        contextWindow: 272_000,
        provider: "openai-codex",
      },
      sessionManager: { getSessionId: () => "session-1" },
      ui: { notify: vi.fn() },
    } as unknown as ExtensionContext;
    contextWindowPolicy(pi);

    handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
    expect(compact).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(compact).toHaveBeenCalledOnce();
  });
});
