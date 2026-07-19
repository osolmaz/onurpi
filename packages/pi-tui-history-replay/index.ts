import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installChronologicalTranscriptPatch } from "./history-replay.ts";

// Vendored from https://github.com/Molaison/pi-tui-history-replay at
// bb5b4389b23391428e810570d35e00924c19fc1b. See UPSTREAM.md.
const REPLAY_ENTRY = "tui-history-replay";

export default function tuiHistoryReplay(pi: ExtensionAPI): void {
  // Hide replay entries persisted by older upstream versions.
  pi.registerEntryRenderer(REPLAY_ENTRY, () => undefined);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    installChronologicalTranscriptPatch(ctx.sessionManager);
  });

  pi.on("session_compact", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const state = installChronologicalTranscriptPatch(ctx.sessionManager);
    state.pendingCompactionEntryId = event.compactionEntry.id;
  });
}
