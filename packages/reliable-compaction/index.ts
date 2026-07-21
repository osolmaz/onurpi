import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installReliableCompaction } from "./reliable-compaction.ts";

export default function reliableCompaction(pi: ExtensionAPI): void {
  installReliableCompaction(
    {
      onBeforeAgentStart: (handler) => {
        pi.on("before_agent_start", handler);
      },
      onSessionBeforeCompact: (handler) => {
        pi.on("session_before_compact", handler);
      },
      onSessionCompact: (handler) => {
        pi.on("session_compact", handler);
      },
      onSessionShutdown: (handler) => {
        pi.on("session_shutdown", handler);
      },
      registerProvider: (name, config) => {
        pi.registerProvider(name, config);
      },
      unregisterProvider: (name) => {
        pi.unregisterProvider(name);
      },
    },
    {
      streamSimple: (model, context, options) => {
        const provider = getApiProvider(model.api);
        if (!provider) throw new Error(`No API provider registered for ${model.api}`);
        return provider.streamSimple(model, context, options);
      },
    },
  );
}
