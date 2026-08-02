import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_ENVIRONMENT_EVENT,
  isCommandEnvironmentEvent,
  type CommandEnvironmentEvent,
} from "@onurpi/unified-exec/command-environment";
import piMustWin, { CommitAttributionSession } from "pi-must-win/index.ts";

export { isCommandEnvironmentEvent } from "@onurpi/unified-exec/command-environment";
export { CommitAttributionSession } from "pi-must-win/index.ts";

function modelName(event: CommandEnvironmentEvent): string {
  const model = event.model;
  if (!model) return "unknown";
  if (model.name) return model.name;
  return `${model.provider}/${model.id}`;
}

export function applyCommitAttribution(
  value: unknown,
  session: CommitAttributionSession,
  piVersion: string,
): boolean {
  if (!isCommandEnvironmentEvent(value)) return false;
  value.environment = session.environment(value.environment, modelName(value), piVersion);
  return true;
}

export default function onurPiMustWin(pi: ExtensionAPI): void {
  const session = new CommitAttributionSession();
  piMustWin(pi, { commitAttributionSession: session });
  const unsubscribe = pi.events.on(COMMAND_ENVIRONMENT_EVENT, (value) => {
    applyCommitAttribution(value, session, VERSION);
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
  });
}
