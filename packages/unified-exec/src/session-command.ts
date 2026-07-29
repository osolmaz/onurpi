import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatSessionChoice, runningSessions, updateRunningSessionsUi } from "./session-ui.ts";
import { terminateSessionById } from "./termination.ts";
import type { ExtensionRuntime } from "./tool-types.ts";

function plural(count: number): string {
  return count === 1 ? "session" : "sessions";
}

export function registerSessionsCommand(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  pi.registerCommand("unified-exec-sessions", {
    description: "List live unified-exec sessions and optionally kill one or all",
    handler: async (_args, ctx) => {
      runtime.ui = ctx.ui;
      const sessions = runningSessions(runtime);
      updateRunningSessionsUi(runtime);
      if (sessions.length === 0) {
        ctx.ui.notify("unified-exec: no live sessions", "info");
        return;
      }
      const now = Date.now();
      const choices = sessions.map((session) => formatSessionChoice(runtime, session, now));
      const killAll = `Kill all ${String(sessions.length)} ${plural(sessions.length)}`;
      const selected = await ctx.ui.select(
        `unified-exec: ${String(sessions.length)} live ${plural(sessions.length)} — select to kill`,
        [...choices, killAll],
      );
      if (!selected) return;
      const targets =
        selected === killAll
          ? sessions
          : sessions.filter((session) => selected.startsWith(`#${String(session.id)} `));
      const outcomes = await Promise.all(
        targets.map((session) => terminateSessionById(runtime, session.id, "SIGTERM")),
      );
      const killed = outcomes.filter((outcome) => outcome?.killed).length;
      const failed = outcomes.filter((outcome) => outcome && !outcome.killed).length;
      updateRunningSessionsUi(runtime);
      ctx.ui.notify(
        `unified-exec: killed ${String(killed)} ${plural(killed)}${failed ? `; ${String(failed)} did not confirm exit` : ""}`,
        failed ? "warning" : "info",
      );
    },
  });
}
