import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installCodexCompaction } from "./codex-compaction.ts";

export default function codexCompactionExtension(pi: ExtensionAPI): void {
  installCodexCompaction({
    onSessionStart: (handler) => {
      pi.on("session_start", () => {
        handler();
      });
    },
    onSessionShutdown: (handler) => {
      pi.on("session_shutdown", () => {
        handler();
      });
    },
    onModelSelect: (handler) => {
      pi.on("model_select", (_event, ctx) => {
        handler(ctx);
      });
    },
    onContext: (handler) => {
      pi.on("context", (event, ctx) => handler(event, ctx));
    },
    onBeforeProviderHeaders: (handler) => {
      pi.on("before_provider_headers", (event, ctx) => {
        handler(event, ctx);
      });
    },
    onBeforeProviderRequest: (handler) => {
      pi.on("before_provider_request", (event, ctx) => handler(event, ctx));
    },
    onSessionBeforeCompact: (handler) => {
      pi.on("session_before_compact", (event, ctx) => handler(event, ctx));
    },
    getAllTools: () => pi.getAllTools(),
    getActiveTools: () => pi.getActiveTools(),
  });
}
