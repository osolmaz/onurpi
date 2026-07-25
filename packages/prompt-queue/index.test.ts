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
  const notify = vi.fn();
  const setWidget = vi.fn();
  const ui = {
    custom: vi.fn().mockResolvedValue(result),
    notify,
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
    notify,
    runtime,
    sendUserMessage,
    setIdle: (next: boolean) => {
      idleState = next;
    },
  };
}

describe("PromptQueueRuntime delivery failures", () => {
  it("holds remaining prompts after an in-flight prompt exhausts its retries", () => {
    const { notify, runtime, sendUserMessage } = setup({ kind: "close" }, true);
    runtime.queue.add("failed in flight", "queue");
    runtime.queue.add("wait for recovery", "queue");

    runtime.onSettled();
    expect(sendUserMessage).toHaveBeenCalledWith("failed in flight");

    runtime.onTurnEnd({ role: "assistant", stopReason: "error" });
    runtime.onTurnEnd({ role: "assistant", stopReason: "error" });
    runtime.onTurnEnd({ role: "assistant", stopReason: "error" });
    runtime.onSettled();

    expect(runtime.gate.holdReason).toBe("error");
    expect(runtime.queue.items().map((item) => item.text)).toEqual(["wait for recovery"]);
    expect(sendUserMessage).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Prompt queue paused after an agent error"),
      "warning",
    );

    runtime.resume();
    expect(runtime.gate.holdReason).toBeUndefined();
    expect(sendUserMessage).toHaveBeenNthCalledWith(2, "wait for recovery");
  });

  it("continues normally when an automatic retry succeeds", () => {
    const { notify, runtime, sendUserMessage } = setup({ kind: "close" }, true);
    runtime.queue.add("continue", "queue");

    runtime.onTurnEnd({ role: "assistant", stopReason: "error" });
    expect(runtime.gate.holdReason).toBeUndefined();
    runtime.onTurnEnd({ role: "assistant", stopReason: "stop" });
    runtime.onSettled();

    expect(runtime.gate.holdReason).toBeUndefined();
    expect(sendUserMessage).toHaveBeenCalledWith("continue");
    expect(notify).not.toHaveBeenCalled();
  });

  it("records an abort hold reason without duplicating its notification at settlement", () => {
    const { notify, runtime, sendUserMessage } = setup({ kind: "close" }, true);
    runtime.queue.add("later", "queue");

    runtime.onTurnEnd({ role: "assistant", stopReason: "aborted" });
    runtime.onAbort();
    runtime.onSettled();

    expect(runtime.gate.holdReason).toBe("abort");
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Prompt queue paused"), "info");
  });
});

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

    runtime.onTurnEnd({ role: "assistant", stopReason: "aborted" });
    runtime.onAbort();
    expect(runtime.gate.holdReason).toBeUndefined();

    setIdle(true);
    runtime.onSettled();
    expect(sendUserMessage).toHaveBeenNthCalledWith(1, "urgent");
    expect(runtime.queue.items().map((item) => item.text)).toEqual(["later"]);

    runtime.onTurnEnd({ role: "assistant", stopReason: "stop" });
    runtime.onSettled();
    expect(sendUserMessage).toHaveBeenNthCalledWith(2, "later");
    expect(runtime.queue.size).toBe(0);
  });
});
