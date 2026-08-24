import { describe, expect, it, vi } from "vitest";

import { runRestartCommand } from "./command.ts";
import type { IpcTransport } from "./ipc-client.ts";
import {
  RESTART_GENERATION_ENV,
  RESTART_PROTOCOL_ENV,
  RESTART_PROTOCOL_SCHEMA,
  type LauncherOutboundMessage,
  type RestartRequest,
  type RuntimeReady,
} from "./protocol.ts";

function launcher(response: "accept" | "reject" = "accept"): IpcTransport {
  const listeners = new Set<(message: unknown) => void>();
  return {
    env: {
      [RESTART_PROTOCOL_ENV]: RESTART_PROTOCOL_SCHEMA,
      [RESTART_GENERATION_ENV]: "generation-1",
    },
    connected: () => true,
    send: (message: RestartRequest | RuntimeReady) => {
      if (message.type === "restartRequest") {
        const result: LauncherOutboundMessage =
          response === "accept"
            ? {
                schema: RESTART_PROTOCOL_SCHEMA,
                type: "restartAccepted",
                requestId: message.requestId,
                generation: message.generation,
              }
            : {
                schema: RESTART_PROTOCOL_SCHEMA,
                type: "restartRejected",
                requestId: message.requestId,
                generation: message.generation,
                reason: "preflight failed",
              };
        queueMicrotask(() => {
          for (const listener of listeners) listener(result);
        });
      }
      return Promise.resolve();
    },
    addMessageListener: (listener) => listeners.add(listener),
    removeMessageListener: (listener) => listeners.delete(listener),
  };
}

function context(overrides: Record<string, unknown> = {}) {
  const notify = vi.fn();
  const shutdown = vi.fn();
  return {
    value: {
      mode: "tui" as const,
      cwd: "/repo",
      isIdle: () => true,
      hasPendingMessages: () => false,
      shutdown,
      sessionManager: {
        getSessionFile: () => "/sessions/one.jsonl",
        getSessionId: () => "session-1",
      },
      ui: { notify },
      ...overrides,
    },
    notify,
    shutdown,
  };
}

describe("/restart command", () => {
  it("shuts down exactly once after launcher acceptance", async () => {
    const ctx = context();
    await runRestartCommand("", ctx.value, launcher());
    expect(ctx.shutdown).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith("Restarting Pi...", "info");
  });

  it("keeps Pi running after launcher rejection", async () => {
    const ctx = context();
    await runRestartCommand("", ctx.value, launcher("reject"));
    expect(ctx.shutdown).not.toHaveBeenCalled();
    expect(ctx.notify.mock.calls.at(-1)?.[0]).toContain("preflight failed");
  });

  it("gives an exact manual command after a direct launch", async () => {
    const ctx = context();
    const direct = launcher();
    direct.env[RESTART_PROTOCOL_ENV] = undefined;
    await runRestartCommand("", ctx.value, direct);
    expect(ctx.shutdown).not.toHaveBeenCalled();
    expect(ctx.notify.mock.calls.at(-1)?.[0]).toContain("pi --session '/sessions/one.jsonl'");
  });

  it("fails closed for unsupported command states", async () => {
    const cases: { rawArgs?: string; overrides?: Record<string, unknown> }[] = [
      { rawArgs: "now" },
      { overrides: { mode: "rpc" } },
      { overrides: { isIdle: () => false } },
      { overrides: { hasPendingMessages: () => true } },
      {
        overrides: {
          sessionManager: {
            getSessionFile: () => undefined,
            getSessionId: (): string => "one",
          },
        },
      },
      {
        overrides: {
          sessionManager: {
            getSessionFile: (): string => "one.jsonl",
            getSessionId: (): string => "one",
          },
        },
      },
    ];
    for (const setup of cases) {
      const ctx = context(setup.overrides);
      await runRestartCommand(setup.rawArgs ?? "", ctx.value, launcher());
      expect(ctx.shutdown).not.toHaveBeenCalled();
      expect(ctx.notify).toHaveBeenCalled();
    }
  });
});
