import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { handleLoopGuardCommand } from "./index.ts";
import { LoopGuardController } from "./loop-guard-controller.ts";

function harness() {
  const sendMessage = vi.fn();
  const runtime: Pick<ExtensionAPI, "events" | "sendMessage"> = {
    events: createEventBus(),
    sendMessage,
  };
  const notify = vi.fn();
  const waitForIdle = vi.fn(() => Promise.resolve());
  const ctx = {
    abort: vi.fn(),
    hasPendingMessages: () => false,
    isIdle: () => true,
    ui: { notify, setStatus: vi.fn() },
    waitForIdle,
  };
  return { controller: new LoopGuardController(runtime), ctx, notify, sendMessage, waitForIdle };
}

describe("handleLoopGuardCommand", () => {
  it("enables, reports, resets, and disables the guard", async () => {
    const test = harness();
    await handleLoopGuardCommand("on", test.controller, test.ctx);
    expect(test.controller.state).toBe("armed");

    await handleLoopGuardCommand("status", test.controller, test.ctx);
    expect(test.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("observing epoch"),
      "info",
    );

    await handleLoopGuardCommand("reset", test.controller, test.ctx);
    expect(test.controller.state).toBe("armed");

    await handleLoopGuardCommand("off", test.controller, test.ctx);
    expect(test.controller.state).toBe("off");
  });

  it("waits for settlement before a manual nudge", async () => {
    const test = harness();
    await handleLoopGuardCommand("on", test.controller, test.ctx);
    await handleLoopGuardCommand("nudge", test.controller, test.ctx);

    expect(test.waitForIdle).toHaveBeenCalledOnce();
    expect(test.sendMessage).toHaveBeenCalledOnce();
    expect(test.controller.state).toBe("nudged");
  });

  it("rejects unknown command arguments", async () => {
    const test = harness();
    await handleLoopGuardCommand("maybe", test.controller, test.ctx);
    expect(test.notify).toHaveBeenLastCalledWith(
      "Usage: /loop-guard on|off|status|reset|nudge",
      "warning",
    );
  });
});
