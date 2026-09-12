/**
 * The `/image-budget` command. Reports the active configuration and the current image load, and
 * reloads the JSON config without restarting Pi.
 */

import { type ImageBudgetConfig, formatBytes, resultOutcomeNotice } from "./image-budget.ts";
import type { ResultOutcome } from "./image-budget.ts";

export type ImageBudgetSnapshot = {
  configPath: string;
  config: ImageBudgetConfig;
  errors: readonly string[];
  lastBytes: number;
  lastImageCount: number;
  redactions: number;
  outcome: ResultOutcome;
};

export type CommandContext = {
  ui: { notify: (message: string, type: "info" | "warning" | "error") => void };
};

export type CommandDeps = {
  snapshot: () => ImageBudgetSnapshot;
  reload: () => readonly string[];
};

const USAGE = "Usage: /image-budget [status|reload]";

function configLines(snapshot: ImageBudgetSnapshot): string[] {
  const { config } = snapshot;
  return [
    `config: ${snapshot.configPath}${config.enabled ? "" : " (disabled)"}`,
    `per image: ${formatBytes(config.maxImageBytes)} at ${String(config.maxImageWidth)}x${String(config.maxImageHeight)}, ${String(config.maxImagesPerResult)} per tool result`,
    `request: redact above ${formatBytes(config.imageBudgetBytes)} down to ${formatBytes(config.redactToBytes)}`,
  ];
}

function activityLines(snapshot: ImageBudgetSnapshot): string[] {
  const applied = resultOutcomeNotice(snapshot.outcome);
  return [
    `current context: ${formatBytes(snapshot.lastBytes)} in ${String(snapshot.lastImageCount)} images`,
    `redacted this session: ${String(snapshot.redactions)}`,
    `tool results: ${applied ?? "nothing changed"}`,
  ];
}

export function imageBudgetReport(snapshot: ImageBudgetSnapshot): string {
  const lines = [
    `image-budget: ${snapshot.config.enabled ? "enabled" : "disabled"}`,
    ...configLines(snapshot),
    ...activityLines(snapshot),
  ];
  if (snapshot.errors.length > 0) lines.push(`config problems: ${snapshot.errors.join("; ")}`);
  return lines.join("\n");
}

export function handleImageBudgetCommand(
  args: string,
  deps: CommandDeps,
  ctx: CommandContext,
): void {
  const trimmed = args.trim();
  if (trimmed === "reload") {
    const errors = deps.reload();
    if (errors.length > 0) {
      ctx.ui.notify(`image-budget: ${errors.join("; ")}`, "warning");
    }
  } else if (trimmed !== "" && trimmed !== "status") {
    ctx.ui.notify(USAGE, "warning");
    return;
  }
  ctx.ui.notify(imageBudgetReport(deps.snapshot()), "info");
}
