import { randomUUID } from "node:crypto";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  EXPECTED_CWD_ENV,
  EXPECTED_SESSION_FILE_ENV,
  EXPECTED_SESSION_ID_ENV,
  parseLauncherOutboundMessage,
  RESTART_GENERATION_ENV,
  RESTART_PROTOCOL_ENV,
  RESTART_PROTOCOL_SCHEMA,
  type RestartRequest,
  type RuntimeReady,
} from "./protocol.ts";

type MessageListener = (message: unknown) => void;

export type IpcTransport = {
  env: NodeJS.ProcessEnv;
  connected(): boolean;
  send(message: RestartRequest | RuntimeReady): Promise<void>;
  addMessageListener(listener: MessageListener): void;
  removeMessageListener(listener: MessageListener): void;
};

export type RestartIdentity = {
  sessionFile: string;
  sessionId: string;
  cwd: string;
};

export type RestartResponse = { accepted: true } | { accepted: false; reason: string };

export function nodeIpcTransport(): IpcTransport {
  return {
    env: process.env,
    connected: () => process.connected && typeof process.send === "function",
    send: (message) =>
      new Promise<void>((resolve, reject) => {
        if (!process.connected || typeof process.send !== "function") {
          reject(new Error("Pi was not started by the restart-aware launcher."));
          return;
        }
        process.send(message, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    addMessageListener: (listener) => {
      process.on("message", listener);
    },
    removeMessageListener: (listener) => {
      process.off("message", listener);
    },
  };
}

function launcherGeneration(transport: IpcTransport): string | undefined {
  if (transport.env[RESTART_PROTOCOL_ENV] !== RESTART_PROTOCOL_SCHEMA) return undefined;
  const generation = transport.env[RESTART_GENERATION_ENV];
  return generation && generation.length <= 128 ? generation : undefined;
}

export function hasRestartLauncher(transport: IpcTransport): boolean {
  return launcherGeneration(transport) !== undefined && transport.connected();
}

export async function requestRestart(
  identity: RestartIdentity,
  transport: IpcTransport = nodeIpcTransport(),
  timeoutMs = 2000,
): Promise<RestartResponse> {
  const generation = launcherGeneration(transport);
  if (!generation || !transport.connected()) {
    return { accepted: false, reason: "Pi was not started by the restart-aware launcher." };
  }

  const request: RestartRequest = {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "restartRequest",
    requestId: randomUUID(),
    generation,
    ...identity,
  };

  return new Promise<RestartResponse>((resolve) => {
    let settled = false;
    const finish = (result: RestartResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      transport.removeMessageListener(onMessage);
      resolve(result);
    };
    const onMessage = (message: unknown): void => {
      const parsed = parseLauncherOutboundMessage(message);
      if (parsed?.requestId !== request.requestId || parsed.generation !== generation) return;
      if (parsed.type === "restartAccepted") finish({ accepted: true });
      else finish({ accepted: false, reason: parsed.reason });
    };
    const timer = setTimeout(() => {
      finish({ accepted: false, reason: "The restart-aware launcher did not respond." });
    }, timeoutMs);
    transport.addMessageListener(onMessage);
    void transport.send(request).catch((error: unknown) => {
      finish({
        accepted: false,
        reason:
          error instanceof Error ? error.message : "Failed to contact the restart-aware launcher.",
      });
    });
  });
}

type RuntimeReadyContext = Pick<ExtensionContext, "cwd"> & {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionFile" | "getSessionId">;
  ui: Pick<ExtensionContext["ui"], "notify">;
};

type ExpectedRuntime = RestartIdentity & { generation: string };

function expectedRuntime(transport: IpcTransport): ExpectedRuntime | undefined {
  const generation = launcherGeneration(transport);
  const sessionFile = transport.env[EXPECTED_SESSION_FILE_ENV];
  const sessionId = transport.env[EXPECTED_SESSION_ID_ENV];
  const cwd = transport.env[EXPECTED_CWD_ENV];
  if (!(generation && sessionFile && sessionId && cwd)) return undefined;
  Reflect.deleteProperty(transport.env, EXPECTED_SESSION_FILE_ENV);
  Reflect.deleteProperty(transport.env, EXPECTED_SESSION_ID_ENV);
  Reflect.deleteProperty(transport.env, EXPECTED_CWD_ENV);
  return { generation, sessionFile, sessionId, cwd };
}

function runtimeMatches(ctx: RuntimeReadyContext, expected: RestartIdentity): boolean {
  return (
    ctx.sessionManager.getSessionFile() === expected.sessionFile &&
    ctx.sessionManager.getSessionId() === expected.sessionId &&
    ctx.cwd === expected.cwd
  );
}

async function sendRuntimeReady(
  ctx: RuntimeReadyContext,
  transport: IpcTransport,
  expected: ExpectedRuntime,
): Promise<boolean> {
  const ready: RuntimeReady = {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "runtimeReady",
    ...expected,
  };
  try {
    await transport.send(ready);
    ctx.ui.notify("Restart complete.", "info");
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Launcher connection failed.";
    ctx.ui.notify(`Restart completed, but confirmation failed: ${reason}`, "warning");
    return false;
  }
}

export async function announceRuntimeReady(
  ctx: RuntimeReadyContext,
  transport: IpcTransport = nodeIpcTransport(),
): Promise<boolean> {
  const expected = expectedRuntime(transport);
  if (!expected) return false;
  if (!runtimeMatches(ctx, expected)) {
    ctx.ui.notify("Restarted Pi opened a different session or working directory.", "error");
    return false;
  }
  return sendRuntimeReady(ctx, transport, expected);
}
