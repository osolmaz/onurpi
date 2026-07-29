import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
  CodexUsageReport,
  NormalizedRateLimitSnapshot,
  NormalizedRateLimitWindow,
  UsageQueryError,
} from "./types.js";

const USAGE_SETTINGS_URL = "https://chatgpt.com/codex/settings/usage";
const BAR_SEGMENTS = 20;
const LIMIT_VALUE_COLUMN = 29;
const RESET_FOREGROUND = "\x1b[39m";

type UsageNotificationContext = {
  hasUI: boolean;
  ui: Pick<ExtensionCommandContext["ui"], "notify">;
};

export function formatCodexUsageReport(report: CodexUsageReport): string {
  const lines = [
    "  >_ OpenAI Codex Usage",
    "",
    `Visit ${USAGE_SETTINGS_URL} for up-to-date`,
    "information on rate limits and credits",
    "",
  ];

  for (const snapshot of report.snapshots) appendSnapshot(lines, snapshot);
  appendResetCredits(lines, report);

  return lines.join("\n");
}

export function showReport(ctx: UsageNotificationContext, report: CodexUsageReport): void {
  const text = formatCodexUsageReport(report);
  ctx.ui.notify(ctx.hasUI ? brightenInfoNotification(text) : text, "info");
}

export function formatQueryErrors(errors: UsageQueryError[]): string {
  const lines = ["Unable to read Codex usage."];
  for (const error of errors) {
    const source = error.source === "pi-auth" ? "Pi auth direct" : "Codex app-server fallback";
    lines.push(`- ${source}: ${error.message}`);
  }
  lines.push("");
  lines.push(
    "Tip: use a Pi OpenAI Codex model or run /login for OpenAI ChatGPT Plus/Pro. If Pi auth is unavailable, install Codex CLI and run codex login for the fallback.",
  );
  return lines.join("\n");
}

function appendSnapshot(lines: string[], snapshot: NormalizedRateLimitSnapshot): void {
  const label = snapshot.limitName ?? snapshot.limitId;
  if (!isPrimaryCodexSnapshot(snapshot)) lines.push(`  ${label} limit:`);
  if (snapshot.primary) lines.push(formatWindowLine(snapshot.primary, "5h"));
  if (snapshot.secondary) lines.push(formatWindowLine(snapshot.secondary, "weekly"));
  if (!snapshot.primary && !snapshot.secondary) {
    lines.push("  Limits unavailable for this account");
  }
}

function appendResetCredits(lines: string[], report: CodexUsageReport): void {
  if (!report.resetCredits) return;
  if (report.snapshots.length > 0) lines.push("");
  lines.push(
    `  ${"Usage limit resets:".padEnd(LIMIT_VALUE_COLUMN)}${String(report.resetCredits.availableCount)} available`,
  );
}

function brightenInfoNotification(text: string): string {
  return `${RESET_FOREGROUND}${text}`;
}

function isPrimaryCodexSnapshot(snapshot: NormalizedRateLimitSnapshot): boolean {
  return (
    normalizedUsageKey(snapshot.limitId) === "codex" ||
    normalizedUsageKey(snapshot.limitName) === "codex"
  );
}

function normalizedUsageKey(value: string | undefined): string | undefined {
  const key = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key === "" ? undefined : key;
}

function formatWindowLine(window: NormalizedRateLimitWindow, fallback: "5h" | "weekly"): string {
  const label = `${formatWindowLabel(window, fallback)} limit:`;
  return `  ${label.padEnd(LIMIT_VALUE_COLUMN)}${formatWindow(window)}`;
}

function formatWindowLabel(window: NormalizedRateLimitWindow, fallback: "5h" | "weekly"): string {
  const minutes = window.windowMinutes;
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return capitalize(fallback);
  if (minutes === 10_080) return "Weekly";
  if (minutes % 10_080 === 0) return `${String(minutes / 10_080)}w`;
  if (minutes % 1_440 === 0) return `${String(minutes / 1_440)}d`;
  if (minutes % 60 === 0) return `${String(minutes / 60)}h`;
  return `${String(minutes)}m`;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function formatWindow(window: NormalizedRateLimitWindow): string {
  const remaining = 100 - clampPercent(window.usedPercent);
  const reset = window.resetsAt ? ` (resets ${formatReset(window.resetsAt)})` : "";
  return `${progressBar(remaining)} ${remaining.toFixed(0)}% left${reset}`;
}

function progressBar(percentRemaining: number): string {
  const filled = Math.round((clampPercent(percentRemaining) / 100) * BAR_SEGMENTS);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_SEGMENTS - filled)}]`;
}

function formatReset(epochSeconds: number): string {
  const reset = new Date(epochSeconds * 1000);
  if (Number.isNaN(reset.getTime())) return "at an unknown time";

  const now = new Date();
  const time = `${reset.getHours().toString().padStart(2, "0")}:${reset
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  if (reset.toDateString() === now.toDateString()) return time;
  const day = reset.getDate().toString();
  const month = reset.toLocaleDateString(undefined, { month: "short" });
  return `${time} on ${day} ${month}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
