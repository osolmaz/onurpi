import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import codexCompactionExtension from "./index.ts";

type Handler = (...args: never[]) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

describe("pi-codex-compaction extension factory", () => {
  it("registers only Pi-owned compaction lifecycle handlers", () => {
    const { pi, handlers } = fakePi();
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
    expect(handlers.has("turn_end")).toBe(false);
    expect(handlers.has("agent_settled")).toBe(false);
    expect(handlers.has("session_compact")).toBe(false);
  });
});
