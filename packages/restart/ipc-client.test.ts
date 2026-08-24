import { describe, expect, it, vi } from "vitest";

import {
  announceRuntimeReady,
  hasRestartLauncher,
  requestRestart,
  type IpcTransport,
} from "./ipc-client.ts";
import {
  EXPECTED_CWD_ENV,
  EXPECTED_SESSION_FILE_ENV,
  EXPECTED_SESSION_ID_ENV,
  RESTART_GENERATION_ENV,
  RESTART_PROTOCOL_ENV,
  RESTART_PROTOCOL_SCHEMA,
  type LauncherOutboundMessage,
  type RestartRequest,
  type RuntimeReady,
} from "./protocol.ts";

type SentMessage = RestartRequest | RuntimeReady;

function transport(
  onSend?: (message: SentMessage, emit: (response: LauncherOutboundMessage) => void) => void,
): IpcTransport & { sent: SentMessage[] } {
  const listeners = new Set<(message: unknown) => void>();
  const sent: SentMessage[] = [];
  const result: IpcTransport & { sent: SentMessage[] } = {
    env: {
      [RESTART_PROTOCOL_ENV]: RESTART_PROTOCOL_SCHEMA,
      [RESTART_GENERATION_ENV]: "generation-1",
    },
    connected: () => true,
    send: (message) => {
      sent.push(message);
      onSend?.(message, (response) => {
        for (const listener of listeners) listener(response);
      });
      return Promise.resolve();
    },
    addMessageListener: (listener) => listeners.add(listener),
    removeMessageListener: (listener) => listeners.delete(listener),
    sent,
  };
  return result;
}

const identity = { sessionFile: "/sessions/one.jsonl", sessionId: "session-1", cwd: "/repo" };

describe("restart IPC client", () => {
  it("detects a compatible launcher", () => {
    expect(hasRestartLauncher(transport())).toBe(true);
    const direct = transport();
    direct.env[RESTART_PROTOCOL_ENV] = undefined;
    expect(hasRestartLauncher(direct)).toBe(false);
  });

  it("accepts only the matching launcher response", async () => {
    const ipc = transport((message, emit) => {
      if (message.type !== "restartRequest") return;
      emit({
        schema: RESTART_PROTOCOL_SCHEMA,
        type: "restartAccepted",
        requestId: "other",
        generation: message.generation,
      });
      emit({
        schema: RESTART_PROTOCOL_SCHEMA,
        type: "restartAccepted",
        requestId: message.requestId,
        generation: message.generation,
      });
    });
    await expect(requestRestart(identity, ipc)).resolves.toEqual({ accepted: true });
    expect(ipc.sent[0]).toMatchObject({ type: "restartRequest", ...identity });
  });

  it("returns launcher rejection, timeout, and send failure", async () => {
    const rejected = transport((message, emit) => {
      if (message.type === "restartRequest") {
        emit({
          schema: RESTART_PROTOCOL_SCHEMA,
          type: "restartRejected",
          requestId: message.requestId,
          generation: message.generation,
          reason: "unsupported args",
        });
      }
    });
    await expect(requestRestart(identity, rejected)).resolves.toEqual({
      accepted: false,
      reason: "unsupported args",
    });
    await expect(requestRestart(identity, transport(), 1)).resolves.toMatchObject({
      accepted: false,
    });
    const failed = transport();
    failed.send = () => Promise.reject(new Error("disconnected"));
    await expect(requestRestart(identity, failed)).resolves.toEqual({
      accepted: false,
      reason: "disconnected",
    });
  });

  it("rejects direct launches without sending", async () => {
    const direct = transport();
    direct.connected = () => false;
    await expect(requestRestart(identity, direct)).resolves.toEqual({
      accepted: false,
      reason: "Pi was not started by the restart-aware launcher.",
    });
    expect(direct.sent).toEqual([]);
  });

  it("announces an exact replacement and rejects identity mismatch", async () => {
    const ipc = transport();
    Object.assign(ipc.env, {
      [EXPECTED_SESSION_FILE_ENV]: identity.sessionFile,
      [EXPECTED_SESSION_ID_ENV]: identity.sessionId,
      [EXPECTED_CWD_ENV]: identity.cwd,
    });
    const notify = vi.fn();
    const ctx = {
      cwd: identity.cwd,
      sessionManager: {
        getSessionFile: () => identity.sessionFile,
        getSessionId: () => identity.sessionId,
      },
      ui: { notify },
    };
    await expect(announceRuntimeReady(ctx, ipc)).resolves.toBe(true);
    expect(ipc.sent).toContainEqual(expect.objectContaining({ type: "runtimeReady", ...identity }));
    expect(notify).toHaveBeenCalledWith("Restart complete.", "info");
    await expect(announceRuntimeReady(ctx, ipc)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);

    const mismatchIpc = transport();
    Object.assign(mismatchIpc.env, {
      [EXPECTED_SESSION_FILE_ENV]: identity.sessionFile,
      [EXPECTED_SESSION_ID_ENV]: identity.sessionId,
      [EXPECTED_CWD_ENV]: identity.cwd,
    });
    const wrong = { ...ctx, cwd: "/other" };
    await expect(announceRuntimeReady(wrong, mismatchIpc)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith(
      "Restarted Pi opened a different session or working directory.",
      "error",
    );
  });

  it("does nothing on an ordinary startup", async () => {
    const ipc = transport();
    const notify = vi.fn();
    await expect(
      announceRuntimeReady(
        {
          cwd: "/repo",
          sessionManager: { getSessionFile: () => undefined, getSessionId: () => "session" },
          ui: { notify },
        },
        ipc,
      ),
    ).resolves.toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
