import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installContextWindowPolicy } from "./context-window-policy.ts";

export default function contextWindowPolicy(pi: ExtensionAPI): void {
  installContextWindowPolicy({
    onAgentSettled: (handler) => {
      pi.on("agent_settled", (_event, ctx) => {
        handler(ctx);
      });
    },
    onModelSelect: (handler) => {
      pi.on("model_select", (_event, ctx) => {
        handler(ctx);
      });
    },
    onSessionCompact: (handler) => {
      pi.on("session_compact", handler);
    },
    onSessionShutdown: (handler) => {
      pi.on("session_shutdown", handler);
    },
    onSessionStart: (handler) => {
      pi.on("session_start", handler);
    },
  });
}
