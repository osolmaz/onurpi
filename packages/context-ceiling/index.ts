import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  createCeilingState,
  describe,
  parseCeilingCommand,
  requestCompaction,
  type CeilingState,
} from "./ceiling.ts";

const STATUS_KEY = "context-ceiling";

type Scheduler = (fn: () => void) => void;

function setWaitStatus(state: CeilingState, ctx: ExtensionContext, waiting: boolean): void {
  if (state.waitingForIdle === waiting) return;
  state.waitingForIdle = waiting;
  ctx.ui.setStatus(
    STATUS_KEY,
    waiting ? "context ceiling: over limit — compacting when the run settles" : undefined,
  );
}

/**
 * Act on the current context sample. Over the ceiling while the session is busy, it only shows a
 * quiet footer status; compacting mid-run would abort the run and surface it as an error. Over
 * the ceiling while idle, it defers the compaction by one macrotask so continuations that other
 * extensions queue at settle can start first, then compacts only if the session is still idle.
 */
function checkUsage(state: CeilingState, ctx: ExtensionContext, schedule: Scheduler): void {
  const usage = ctx.getContextUsage();
  const decision = usage ? requestCompaction(state, usage, ctx.isIdle()) : "none";
  setWaitStatus(state, ctx, decision === "deferred");
  if (decision !== "requested") return;

  state.compactionInFlight = true;
  schedule(() => {
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      state.compactionInFlight = false;
      return;
    }
    ctx.ui.notify(`${describe(state)} — compacting`, "info");
    ctx.compact({
      onComplete: () => {
        state.compactionInFlight = false;
      },
      onError: () => {
        state.compactionInFlight = false;
        ctx.ui.notify(
          "Context ceiling compaction failed; it will retry on the next turn",
          "warning",
        );
      },
    });
  });
}

export default function contextCeilingExtension(pi: ExtensionAPI): void {
  const state = createCeilingState();
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const schedule: Scheduler = (fn) => {
    scheduled = setTimeout(() => {
      scheduled = undefined;
      fn();
    }, 0);
  };

  pi.on("session_start", (_event, ctx) => {
    if (scheduled !== undefined) {
      clearTimeout(scheduled);
      scheduled = undefined;
    }
    state.compactionInFlight = false;
    state.waitingForIdle = false;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
  pi.on("turn_end", (_event, ctx) => {
    checkUsage(state, ctx, schedule);
  });
  pi.on("agent_before_settle", (_event, ctx) => {
    checkUsage(state, ctx, schedule);
  });
  pi.on("agent_settled", (_event, ctx) => {
    checkUsage(state, ctx, schedule);
  });
  pi.on("session_shutdown", () => {
    if (scheduled !== undefined) {
      clearTimeout(scheduled);
      scheduled = undefined;
    }
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
      const wasEnabled = state.enabled;
      Object.assign(state, parsed.state);
      if (wasEnabled && !state.enabled) {
        state.waitingForIdle = false;
        ctx.ui.setStatus(STATUS_KEY, undefined);
      }
      ctx.ui.notify(describe(state), "info");
    },
  });
}
