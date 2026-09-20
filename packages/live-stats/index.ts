import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  countOutputContentChars,
  formatShimmeredWorkingMessage,
  formatStyledSpinnerFrames,
  lightenRamp,
  lightenRamp256,
  LiveStatsTracker,
  parseAnsi256Foreground,
  parseTruecolorForeground,
  SHIMMER_SWEEP_FRACTION,
  WORKING_SPINNER,
  type ColorStyler,
  type WorkingMessageStyles,
} from "./live-stats.ts";

const REFRESH_INTERVAL_MS = 50;
const SHIMMER_SWEEP_MS = 4_200;
const SHIMMER_STOPS = 4;
const SHIMMER_CYCLE_MS = SHIMMER_SWEEP_MS / SHIMMER_SWEEP_FRACTION;

// The ramp keeps the theme's own warning color. A truecolor theme is blended toward a lighter tint
// of the same hue. A 256-color theme is blended in RGB, and only the lighter stops are mapped back
// to palette indices. A theme with no usable warning escape keeps the whole line in warning color.
function colorRamp(ctx: ExtensionContext): ColorStyler[] {
  const theme = ctx.ui.theme;
  const mode = theme.getColorMode();
  if (mode === "truecolor") {
    const base = parseTruecolorForeground(theme.getFgAnsi("warning"));
    if (base !== undefined) return lightenRamp(base, SHIMMER_STOPS);
  }
  if (mode === "256color") {
    const index = parseAnsi256Foreground(theme.getFgAnsi("warning"));
    if (index !== undefined) return lightenRamp256(index, SHIMMER_STOPS);
  }
  return [(text) => theme.fg("warning", text)];
}

function workingMessageStyles(ctx: ExtensionContext): WorkingMessageStyles {
  return {
    bold: (text) => ctx.ui.theme.bold(text),
    ramp: colorRamp(ctx),
  };
}

// Pi has no theme-change event, so the frames are re-applied whenever the theme's warning escape
// changes. Without this check the spinner would keep the old theme's colors after a theme switch
// while the message used the new ones.
let appliedSpinnerKey: string | undefined;

function spinnerKey(ctx: ExtensionContext): string {
  const theme = ctx.ui.theme;
  return `${theme.getColorMode()} ${theme.getFgAnsi("warning")}`;
}

function syncWorkingSpinner(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  const key = spinnerKey(ctx);
  if (key === appliedSpinnerKey) return;
  ctx.ui.setWorkingIndicator({
    frames: formatStyledSpinnerFrames(WORKING_SPINNER.frames, workingMessageStyles(ctx)),
    intervalMs: WORKING_SPINNER.intervalMs,
  });
  appliedSpinnerKey = key;
}

export default function liveStats(pi: ExtensionAPI): void {
  const tracker = new LiveStatsTracker();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = (): void => {
    if (refreshTimer === undefined) return;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  };

  const render = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" || !tracker.active) return;
    syncWorkingSpinner(ctx);
    const snapshot = tracker.snapshot(Date.now());
    ctx.ui.setWorkingMessage(
      formatShimmeredWorkingMessage(
        snapshot,
        workingMessageStyles(ctx),
        snapshot.elapsedMs / SHIMMER_CYCLE_MS,
      ),
    );
  };

  const reset = (ctx: ExtensionContext): void => {
    stopTimer();
    tracker.reset();
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
  };

  pi.on("session_start", (_event, ctx) => {
    syncWorkingSpinner(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    stopTimer();
    const now = Date.now();
    tracker.start(now);
    render(ctx);
    refreshTimer = setInterval(() => {
      render(ctx);
    }, REFRESH_INTERVAL_MS);
  });

  pi.on("message_start", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
    syncWorkingSpinner(ctx);
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
