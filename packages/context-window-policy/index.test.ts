import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import contextWindowPolicy from "./index.ts";

type Handler = (...args: never[]) => unknown;

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
});
