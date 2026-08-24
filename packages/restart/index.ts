import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { runRestartCommand } from "./command.ts";
import { announceRuntimeReady } from "./ipc-client.ts";

export default function restartExtension(pi: ExtensionAPI): void {
  pi.registerCommand("restart", {
    description: "Restart Pi and reopen this exact session",
    handler: runRestartCommand,
  });

  pi.on("session_start", async (_event, ctx) => {
    await announceRuntimeReady(ctx);
  });
}
