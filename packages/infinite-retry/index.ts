import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  installInfiniteRetryPatch,
  type InfiniteRetryPatchLease,
  type RetryStatus,
} from "./infinite-retry.ts";

const STATUS_ID = "infinite-retry";

export default function infiniteRetry(pi: ExtensionAPI): void {
  let lease: InfiniteRetryPatchLease | undefined;
  let startupError: Error | undefined;
  let context: ExtensionContext | undefined;
  let countdownTimer: NodeJS.Timeout | undefined;

  try {
    lease = installInfiniteRetryPatch();
  } catch (error) {
    startupError = error instanceof Error ? error : new Error(String(error));
  }

  const clearCountdown = (): void => {
    if (countdownTimer === undefined) return;
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  };
  const renderStatus = (status: RetryStatus): void => {
    clearCountdown();
    updateStatus(context, status);
    if (status.state !== "waiting") return;
    countdownTimer = setInterval(() => {
      updateStatus(context, status);
    }, 1_000);
  };
  const removeReporter = lease?.onStatus(renderStatus);

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    if (startupError !== undefined) {
      ctx.ui.notify(startupError.message, "error");
      return;
    }
    if (lease !== undefined) renderStatus(lease.getStatus());
  });

  pi.on("session_shutdown", () => {
    clearCountdown();
    context?.ui.setStatus(STATUS_ID, undefined);
    context = undefined;
    removeReporter?.();
    lease?.release();
  });

  pi.registerShortcut("alt+r", {
    description: "Retry now during Infinite Retry backoff",
    handler: (ctx) => {
      retryNow(lease, startupError, ctx);
    },
  });

  pi.registerCommand("retry-now", {
    description: "Wake a pending Infinite Retry backoff immediately",
    handler: (_args, ctx) => {
      retryNow(lease, startupError, ctx);
      return Promise.resolve();
    },
  });

  pi.registerCommand("retry-status", {
    description: "Show Infinite Retry status",
    handler: (_args, ctx) => showRetryStatus(lease, startupError, ctx),
  });
}

function showRetryStatus(
  lease: InfiniteRetryPatchLease | undefined,
  startupError: Error | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  if (startupError !== undefined) {
    ctx.ui.notify(startupError.message, "error");
    return Promise.resolve();
  }
  const status = lease?.getStatus();
  if (status?.state !== "waiting") {
    ctx.ui.notify("Infinite Retry is idle", "info");
    return Promise.resolve();
  }
  ctx.ui.notify(
    `Infinite Retry attempt ${String(status.attempt)} is waiting ${formatDuration(remainingMs(status))}`,
    "info",
  );
  return Promise.resolve();
}

function retryNow(
  lease: InfiniteRetryPatchLease | undefined,
  startupError: Error | undefined,
  ctx: ExtensionContext,
): void {
  if (startupError !== undefined) {
    ctx.ui.notify(startupError.message, "error");
    return;
  }
  if (lease?.retryNow() !== true) {
    ctx.ui.notify("No retry backoff is waiting", "warning");
    return;
  }
  ctx.ui.notify("Retrying now", "info");
}

function updateStatus(ctx: ExtensionContext | undefined, status: RetryStatus): void {
  if (ctx === undefined) return;
  if (status.state === "idle") {
    ctx.ui.setStatus(STATUS_ID, undefined);
    return;
  }
  const label = `retry ${String(status.attempt)}/∞ in ${formatDuration(remainingMs(status))} · Alt+R now`;
  ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", label));
}

function remainingMs(status: Extract<RetryStatus, { state: "waiting" }>): number {
  return Math.max(0, status.dueAt - Date.now());
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(remainder)}s`;
}
