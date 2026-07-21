import { streamSimple } from "@earendil-works/pi-ai/compat";
import { compact, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installReliableCompaction } from "./reliable-compaction.ts";

export default function reliableCompaction(pi: ExtensionAPI): void {
  installReliableCompaction(
    {
      getThinkingLevel: () => pi.getThinkingLevel(),
      onSessionBeforeCompact: (handler) => {
        pi.on("session_before_compact", handler);
      },
    },
    { compact, streamSimple },
  );
}
