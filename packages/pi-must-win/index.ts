import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_ENVIRONMENT_EVENT,
  isCommandEnvironmentEvent,
  type CommandEnvironmentEvent,
} from "@onurpi/unified-exec/command-environment";
import piMustWin, {
  CommitAttributionSession,
  disabledEntriesForEnv,
  isRepoDisabledForSession,
  type RepoDisableOptions,
} from "pi-must-win/index.ts";

export { isCommandEnvironmentEvent } from "@onurpi/unified-exec/command-environment";
export { CommitAttributionSession } from "pi-must-win/index.ts";

/** Test and integration overrides for the upstream repository disable check. */
export type OnurPiMustWinOptions = RepoDisableOptions;

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

export default function onurPiMustWin(pi: ExtensionAPI, options: OnurPiMustWinOptions = {}): void {
  // Upstream gates its own registration; this gate also skips the Unified Exec subscription.
  if (isRepoDisabledForSession(options)) return;
  // The session carries the pre-normalized disabled entries so the hook-time matcher runs in
  // every child environment, not just in the built-in Bash integration.
  const session = new CommitAttributionSession(disabledEntriesForEnv(options.configPath));
  piMustWin(pi, { commitAttributionSession: session, repoDisable: options });
  const unsubscribe = pi.events.on(COMMAND_ENVIRONMENT_EVENT, (value) => {
    if (!isCommandEnvironmentEvent(value)) return;
    try {
      applyCommitAttribution(value, session, VERSION);
    } catch (error) {
      value.reject(error);
    }
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
  });
}
