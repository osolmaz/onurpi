/**
 * The `/session-policy` command. Reports the active configuration and the cache state, and reloads
 * the JSON config without restarting Pi.
 */

import { type SessionPolicyConfig } from "./config.ts";

export type SessionPolicySnapshot = {
  configPath: string;
  config: SessionPolicyConfig;
  errors: readonly string[];
  cacheBytes: number;
  cacheCount: number;
  liveMarkers: number;
  ejected: number;
};

export type CommandContext = {
  ui: { notify: (message: string, type: "info" | "warning" | "error") => void };
};

export type CommandDeps = {
  snapshot: () => SessionPolicySnapshot;
  reload: () => readonly string[];
};

const USAGE = "Usage: /session-policy [status|reload]";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} B`;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

export function sessionPolicyReport(snapshot: SessionPolicySnapshot): string {
  const { config } = snapshot;
  const lines = [
    `session-policy: ${config.enabled ? "enabled" : "disabled"}`,
    `config: ${snapshot.configPath}`,
    `per image: ${formatBytes(config.maxImageBytes)} at ${String(config.maxImageWidth)}x${String(config.maxImageHeight)}`,
    `cache: ${formatBytes(snapshot.cacheBytes)} of ${formatBytes(config.cacheMaxBytes)} in ${plural(snapshot.cacheCount, "image")}`,
    `live markers: ${String(snapshot.liveMarkers)}`,
    `ejected payloads: ${String(snapshot.ejected)}`,
  ];
  if (snapshot.errors.length > 0) lines.push(`config problems: ${snapshot.errors.join("; ")}`);
  return lines.join("\n");
}

export function handleSessionPolicyCommand(
  args: string,
  deps: CommandDeps,
  ctx: CommandContext,
): void {
  const trimmed = args.trim();
  if (trimmed === "reload") {
    const errors = deps.reload();
    if (errors.length > 0) {
      ctx.ui.notify(`session-policy: ${errors.join("; ")}`, "warning");
    }
  } else if (trimmed !== "" && trimmed !== "status") {
    ctx.ui.notify(USAGE, "warning");
    return;
  }
  ctx.ui.notify(sessionPolicyReport(deps.snapshot()), "info");
}
