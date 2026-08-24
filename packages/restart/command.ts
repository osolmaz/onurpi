import { isAbsolute } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  hasRestartLauncher,
  nodeIpcTransport,
  requestRestart,
  type IpcTransport,
  type RestartIdentity,
} from "./ipc-client.ts";
import { manualRestartCommand } from "./recovery.ts";

type RestartCommandContext = Pick<
  ExtensionCommandContext,
  "mode" | "cwd" | "isIdle" | "hasPendingMessages" | "shutdown"
> & {
  sessionManager: Pick<
    ExtensionCommandContext["sessionManager"],
    "getSessionFile" | "getSessionId"
  >;
  ui: Pick<ExtensionCommandContext["ui"], "notify">;
};

type CommandError = { message: string; level: "error" | "warning" };

function commandStateError(rawArgs: string, ctx: RestartCommandContext): CommandError | undefined {
  if (rawArgs.trim()) return { message: "Usage: /restart", level: "error" };
  if (ctx.mode !== "tui") {
    return { message: "/restart is available only in interactive TUI mode.", level: "error" };
  }
  if (!ctx.isIdle() || ctx.hasPendingMessages()) {
    return { message: "Pi must be idle with no queued messages before restart.", level: "warning" };
  }
  return undefined;
}

function restartIdentity(ctx: RestartCommandContext): RestartIdentity | undefined {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile || !isAbsolute(sessionFile)) return undefined;
  return { sessionFile, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd };
}

function notifyError(ctx: RestartCommandContext, error: CommandError): void {
  ctx.ui.notify(error.message, error.level);
}

export async function runRestartCommand(
  rawArgs: string,
  ctx: RestartCommandContext,
  transport: IpcTransport = nodeIpcTransport(),
): Promise<void> {
  const stateError = commandStateError(rawArgs, ctx);
  if (stateError) {
    notifyError(ctx, stateError);
    return;
  }
  const identity = restartIdentity(ctx);
  if (!identity) {
    ctx.ui.notify("/restart requires a persisted session with an absolute file path.", "error");
    return;
  }
  const manual = manualRestartCommand(identity.sessionFile);
  if (!hasRestartLauncher(transport)) {
    ctx.ui.notify(
      `Automatic restart requires pi-restart.\nRestart manually with:\n${manual}`,
      "warning",
    );
    return;
  }

  const response = await requestRestart(identity, transport);
  if (!response.accepted) {
    ctx.ui.notify(
      `Restart was not started: ${response.reason}\nRestart manually with:\n${manual}`,
      "error",
    );
    return;
  }
  ctx.ui.notify("Restarting Pi...", "info");
  ctx.shutdown();
}
