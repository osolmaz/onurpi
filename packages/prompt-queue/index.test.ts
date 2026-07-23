import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { PromptQueueRuntime } from "./index.ts";
import type { ManagerResult } from "./window-state.ts";

function setup(result: ManagerResult, idle: boolean) {
  let idleState = idle;
  const sendUserMessage = vi.fn();
  const pi = { sendUserMessage } as unknown as ExtensionAPI;
  const abort = vi.fn();
  const setWidget = vi.fn();
  const ui = {
    custom: vi.fn().mockResolvedValue(result),
    notify: vi.fn(),
    setWidget,
    theme: {
      fg: (_color: string, text: string) => text,
    },
  } as unknown as ExtensionUIContext;
  const ctx = {
    abort,
    isIdle: () => idleState,
    mode: "tui",
    ui,
  } as unknown as ExtensionContext;
  const runtime = new PromptQueueRuntime(pi);
  runtime.setContext(ctx);
  return {
    abort,
    runtime,
    sendUserMessage,
    setIdle: (next: boolean) => {
      idleState = next;
    },
  };
}

describe("PromptQueueRuntime send now", () => {
  it("sends immediately without aborting when the agent is idle", async () => {
    const { abort, runtime, sendUserMessage } = setup({ kind: "send-now", text: "urgent" }, true);

    await runtime.openManager();

    expect(abort).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith("urgent");
  });

  it("aborts a busy run, sends on settle, and preserves later queue delivery", async () => {
    const { abort, runtime, sendUserMessage, setIdle } = setup(
      { kind: "send-now", text: "urgent" },
      false,
    );
    runtime.queue.add("later", "queue");

    await runtime.openManager();

    expect(abort).toHaveBeenCalledOnce();
    expect(sendUserMessage).not.toHaveBeenCalled();

    runtime.onAbort();
    expect(runtime.gate.held).toBe(false);

    setIdle(true);
    runtime.onSettled();
    expect(sendUserMessage).toHaveBeenNthCalledWith(1, "urgent");
    expect(runtime.queue.items().map((item) => item.text)).toEqual(["later"]);

    runtime.onSettled();
    expect(sendUserMessage).toHaveBeenNthCalledWith(2, "later");
    expect(runtime.queue.size).toBe(0);
  });
});
