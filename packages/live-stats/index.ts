import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  countOutputContentChars,
  formatShimmeringWorkingMessage,
  LiveStatsTracker,
  type WorkingMessageStyles,
} from "./live-stats.ts";
import { WorkingPhraseState } from "./working-phrases.ts";

const REFRESH_INTERVAL_MS = 50;

function workingMessageStyles(ctx: ExtensionContext): WorkingMessageStyles {
  return {
    bold: (text) => ctx.ui.theme.bold(text),
    muted: (text) => ctx.ui.theme.fg("muted", text),
    accent: (text) => ctx.ui.theme.fg("accent", text),
  };
}

function canRender(
  ctx: ExtensionContext,
  trackerActive: boolean,
  phrase: string | undefined,
  shimmerStartedAtMs: number | undefined,
): boolean {
  return (
    ctx.mode === "tui" && trackerActive && phrase !== undefined && shimmerStartedAtMs !== undefined
  );
}

export default function liveStats(pi: ExtensionAPI): void {
  const tracker = new LiveStatsTracker();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let shimmerStartedAtMs: number | undefined;
  const workingPhrase = new WorkingPhraseState();

  const stopTimer = (): void => {
    if (refreshTimer === undefined) return;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  };

  const render = (ctx: ExtensionContext): void => {
    if (!canRender(ctx, tracker.active, workingPhrase.current, shimmerStartedAtMs)) return;
    const now = Date.now();
    const message = formatShimmeringWorkingMessage(
      tracker.snapshot(now),
      workingPhrase.current,
      now - shimmerStartedAtMs,
      workingMessageStyles(ctx),
    );
    ctx.ui.setWorkingMessage(message);
  };

  const reset = (ctx: ExtensionContext): void => {
    stopTimer();
    tracker.reset();
    workingPhrase.reset();
    shimmerStartedAtMs = undefined;
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
  };

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    stopTimer();
    const now = Date.now();
    if (workingPhrase.current === undefined) {
      workingPhrase.start();
      shimmerStartedAtMs = now;
    }
    tracker.start(now);
    render(ctx);
    refreshTimer = setInterval(() => {
      render(ctx);
    }, REFRESH_INTERVAL_MS);
  });

  pi.on("message_start", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
    tracker.startMessage();
  });

  pi.on("message_update", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const streamEvent = event.assistantMessageEvent;
    if (
      streamEvent.type === "text_delta" ||
      streamEvent.type === "thinking_delta" ||
      streamEvent.type === "toolcall_delta"
    ) {
      tracker.addDelta(streamEvent.delta, Date.now());
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;

    tracker.finishMessage(
      event.message.usage.output,
      countOutputContentChars(event.message.content),
    );
    render(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode === "tui") stopTimer();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.isIdle()) reset(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    reset(ctx);
  });
}
