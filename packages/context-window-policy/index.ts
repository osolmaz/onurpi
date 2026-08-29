import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installContextWindowPolicy } from "./context-window-policy.ts";

export default function contextWindowPolicy(pi: ExtensionAPI): void {
  installContextWindowPolicy({
    onTurnEnd: (handler) => {
      pi.on("turn_end", (event, ctx) => {
        handler(event, ctx);
      });
    },
    onAgentSettled: (handler) => {
      pi.on("agent_settled", (_event, ctx) => {
        handler(ctx);
      });
    },
    onSessionBeforeCompact: (handler) => {
      pi.on("session_before_compact", (event, ctx) => {
        handler(event, ctx);
      });
    },
    onSessionCompact: (handler) => {
      pi.on("session_compact", (event, ctx) => {
        handler(event, ctx);
      });
    },
    onSessionCompactFailed: (handler) => {
      pi.on("session_compact_failed", (_event, ctx) => {
        handler(ctx);
      });
    },
    onModelSelect: (handler) => {
      pi.on("model_select", handler);
    },
    onSessionStart: (handler) => {
      pi.on("session_start", handler);
    },
    onSessionShutdown: (handler) => {
      pi.on("session_shutdown", handler);
    },
    scheduleAfterSettlement: (handler) => {
      setTimeout(handler, 0);
    },
    sendMessage: (message, options) => {
      pi.sendMessage(message, options);
    },
  });
}
