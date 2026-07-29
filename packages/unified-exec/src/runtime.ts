import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  CompletionCoordinator,
  type CompletionCoordinatorOptions,
  type WakeMessage,
} from "./completion.ts";
import { LRU_PROTECTED_COUNT, MAX_SESSIONS } from "./constants.ts";
import { SessionStore } from "./session-store.ts";
import type { AgentActivity, ExtensionRuntime } from "./tool-types.ts";

type RuntimeOptions = Readonly<{
  send: (message: WakeMessage) => void | Promise<void>;
  coordinator?: Omit<CompletionCoordinatorOptions, "send" | "canSend" | "onSendError">;
}>;

export function createRuntimeState(options: RuntimeOptions): ExtensionRuntime {
  const agentActivity: AgentActivity = { active: false };
  let runtime: ExtensionRuntime | undefined;
  const coordinator = new CompletionCoordinator({
    ...options.coordinator,
    canSend: () => !agentActivity.active,
    send: options.send,
    onSendError: (error) => {
      runtime?.ui?.notify(
        `unified-exec: failed to deliver completion notification: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    },
  });
  runtime = {
    coordinator,
    store: new SessionStore({ maxSessions: MAX_SESSIONS, lruProtectedCount: LRU_PROTECTED_COUNT }),
    ui: undefined,
    widgetVisible: false,
    exitUnsubscribers: new Map(),
    warnedShellFallback: false,
    notifiedBashSource: false,
    pendingSessions: new Set(),
    shuttingDown: false,
    agentActivity,
  };
  return runtime;
}

export function createRuntime(pi: ExtensionAPI): ExtensionRuntime {
  return createRuntimeState({
    send: (message) => {
      pi.sendMessage(
        {
          customType: "unified-exec-completed",
          content: message.content,
          display: true,
          details: message.details,
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    },
  });
}
