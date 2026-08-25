import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import {
  COMPACTION_STATUS_KIND,
  FORCED_COMPACTION_DISPLAY_EVENT,
  installCodexCompaction,
  type CompactionStatus,
} from "./codex-compaction.ts";

export default function codexCompactionExtension(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<CompactionStatus>(COMPACTION_STATUS_KIND, (entry, _options, theme) => {
    const data = entry.data;
    if (data?.state === "running") {
      return new Text(theme.fg("accent", "◐ OpenAI compaction running…"), 0, 0);
    }
    if (data?.state === "complete") {
      return new Text(theme.fg("success", "✓ OpenAI compaction complete"), 0, 0);
    }
    const suffix = data?.error ? `: ${data.error}` : "";
    return new Text(theme.fg("error", `✗ OpenAI compaction failed${suffix}`), 0, 0);
  });

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
    onTurnEnd: (handler) => {
      pi.on("turn_end", (_event, ctx) => {
        handler(ctx);
      });
    },
    onSessionCompact: (handler) => {
      pi.on("session_compact", (event, ctx) => {
        handler(event, ctx);
      });
    },
    onAgentSettled: (handler) => {
      pi.on("agent_settled", (_event, ctx) => {
        handler(ctx);
      });
    },
    appendEntry: (customType, data) => {
      pi.appendEntry(customType, data);
    },
    emitForcedCompactionDisplay: (event) => {
      pi.events.emit(FORCED_COMPACTION_DISPLAY_EVENT, event);
    },
    sendMessage: (message, options) => {
      pi.sendMessage(message, options);
    },
    getAllTools: () => pi.getAllTools(),
    getActiveTools: () => pi.getActiveTools(),
  });
}
