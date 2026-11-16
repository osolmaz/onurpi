import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  clearSessionExitWatchers,
  runningSessions,
  updateRunningSessionsUi,
} from "./session-ui.ts";
import { createRuntime } from "./runtime.ts";
import { registerSessionsCommand } from "./session-command.ts";
import { shutdownSessions } from "./termination.ts";
import { registerTools } from "./tools.ts";
import { isPtyAvailable } from "./pty.ts";
export { MAX_EMPTY_POLL_ENV_VAR } from "./constants.ts";
export { resolveMaxEmptyPollMs } from "./tool-helpers.ts";

function keepBuiltinBash(pi: ExtensionAPI): boolean {
  return pi.getFlag("keep-builtin-bash") === true;
}

export default function unifiedExec(pi: ExtensionAPI): void {
  const runtime = createRuntime(pi);

  pi.registerFlag("keep-builtin-bash", {
    description: "Keep Pi's built-in bash tool alongside unified-exec tools",
    type: "boolean",
    default: false,
  });
  registerTools(pi, runtime);
  registerSessionsCommand(pi, runtime);

  pi.on("tool_execution_end", (event) => {
    runtime.coordinator.handleToolExecutionEnd(event.toolCallId, event.isError === true);
  });
  pi.on("agent_start", () => {
    runtime.agentActivity.active = true;
  });
  pi.on("agent_settled", () => {
    runtime.agentActivity.active = false;
    runtime.steer.reset();
    runtime.coordinator.flushPending();
  });
  // A human steer queued during a long wait ends the wait early, so that Pi
  // can deliver it after this tool batch (see steer-gate.ts).
  pi.on("input", (event, ctx) => {
    runtime.steer.observeInput(event, ctx);
  });
  pi.on("message_start", (event) => {
    runtime.steer.observeMessageStart(event);
  });
  pi.on("session_start", (_event, ctx) => {
    runtime.ui = ctx.ui;
    runtime.shuttingDown = false;
    runtime.agentActivity.active = false;
    runtime.steer.reset();
    runtime.coordinator.reset();
    updateRunningSessionsUi(runtime);
    if (!keepBuiltinBash(pi)) {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "bash"));
    }
    if (!isPtyAvailable() && ctx.hasUI) {
      ctx.ui.notify("unified-exec: PTY unavailable; tty: false remains available", "info");
    }
  });
  pi.on("session_tree", (_event, ctx) => {
    runtime.ui = ctx.ui;
    updateRunningSessionsUi(runtime, {
      showWidget: true,
      notifyTree: runningSessions(runtime).length > 0,
    });
  });
  pi.on("session_shutdown", async () => {
    runtime.steer.reset();
    await shutdownSessions(runtime);
    clearSessionExitWatchers(runtime);
    updateRunningSessionsUi(runtime);
  });
}
