import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  countOutputContentChars,
  EmojiSpinnerState,
  formatStyledWorkingMessage,
  LiveStatsTracker,
  type WorkingMessageStyles,
} from "./live-stats.ts";
import { applySpinner, registerSpinnerCommand } from "./spinner-command.ts";
import { WorkingPhraseState } from "./working-phrases.ts";

const REFRESH_INTERVAL_MS = 50;

function workingMessageStyles(ctx: ExtensionContext): WorkingMessageStyles {
  return {
    bold: (text) => ctx.ui.theme.bold(text),
    warning: (text) => ctx.ui.theme.fg("warning", text),
  };
}

export default function liveStats(pi: ExtensionAPI): void {
  const tracker = new LiveStatsTracker();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const workingPhrase = new WorkingPhraseState();
  const spinnerState = new EmojiSpinnerState();

  const stopTimer = (): void => {
    if (refreshTimer === undefined) return;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  };

  const render = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" || !tracker.active) return;
    const phrase = workingPhrase.current;
    if (phrase === undefined) return;
    const message = formatStyledWorkingMessage(
      tracker.snapshot(Date.now()),
      phrase,
      workingMessageStyles(ctx),
    );
    ctx.ui.setWorkingMessage(message);
  };

  const reset = (ctx: ExtensionContext): void => {
    stopTimer();
    tracker.reset();
    workingPhrase.reset();
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
  };

  pi.on("session_start", (_event, ctx) => {
    applySpinner(ctx, spinnerState);
  });

  registerSpinnerCommand(pi, spinnerState);

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    stopTimer();
    const now = Date.now();
    if (workingPhrase.current === undefined) workingPhrase.start();
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
