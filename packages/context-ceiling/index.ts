import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  createCeilingState,
  describe,
  parseCeilingCommand,
  requestCompaction,
  type CeilingState,
} from "./ceiling.ts";

function checkUsage(state: CeilingState, ctx: ExtensionContext): void {
  const usage = ctx.getContextUsage();
  if (!usage) return;
  if (requestCompaction(state, usage) !== "requested") return;
  state.compactionInFlight = true;
  ctx.ui.notify(describe(state) + " — compacting", "info");
  ctx.compact({
    onComplete: () => {
      state.compactionInFlight = false;
    },
    onError: () => {
      state.compactionInFlight = false;
      ctx.ui.notify("Context ceiling compaction failed; it will retry on the next turn", "warning");
    },
  });
}

export default function contextCeilingExtension(pi: ExtensionAPI): void {
  const state = createCeilingState();

  pi.on("session_start", () => {
    state.compactionInFlight = false;
  });
  pi.on("turn_end", (_event, ctx) => {
    checkUsage(state, ctx);
  });
  pi.on("agent_before_settle", (_event, ctx) => {
    checkUsage(state, ctx);
  });

  pi.registerCommand("context-ceiling", {
    description: "Show, toggle, or retarget the global context ceiling (default 272,000 tokens)",
    getArgumentCompletions: (prefix: string) => {
      const options = ["status", "on", "off"].filter((option) => option.startsWith(prefix));
      return options.length === 0
        ? null
        : options.map((option) => ({ label: option, value: option }));
    },
    // The command API requires an async handler; the body is a synchronous state update.
    // eslint-disable-next-line @typescript-eslint/require-await
    handler: async (args, ctx) => {
      const parsed = parseCeilingCommand(state, args);
      if ("status" in parsed) {
        ctx.ui.notify(parsed.status, "info");
        return;
      }
      Object.assign(state, parsed.state);
      ctx.ui.notify(describe(state), "info");
    },
  });
}
