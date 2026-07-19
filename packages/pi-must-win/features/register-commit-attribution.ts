import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, VERSION } from "@earendil-works/pi-coding-agent";
import { CommitAttributionSession } from "./commit-attribution.ts";

export function registerCommitAttribution(pi: ExtensionAPI): void {
  const session = new CommitAttributionSession();

  pi.on("session_start", () => {
    session.start();
  });

  pi.on("session_shutdown", () => {
    session.stop();
  });

  pi.on("tool_call", (event, context) => {
    if (!isToolCallEventType("bash", event)) return;

    const model = context.model;
    const modelName = model ? model.name || `${model.provider}/${model.id}` : "unknown";
    event.input.command = session.wrap(event.input.command, modelName, VERSION);
  });
}
