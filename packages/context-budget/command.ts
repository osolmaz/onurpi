/**
 * The `/context-budget` command. Reports what the fixed beginning of every request costs, and
 * reloads the JSON config without restarting Pi.
 */

import { reportLines, type ReportInput } from "./context-budget.ts";

export const WIDGET_KEY = "context-budget";

export type CommandContext = {
  ui: {
    notify: (message: string, type: "info" | "warning" | "error") => void;
    setWidget: (key: string, content: string[] | undefined) => void;
  };
};

export type CommandDeps = {
  snapshot: () => ReportInput;
  reload: () => readonly string[];
};

const USAGE = "Usage: /context-budget [show|reload|clear]";

export function handleContextBudgetCommand(
  args: string,
  deps: CommandDeps,
  ctx: CommandContext,
): void {
  const trimmed = args.trim();
  if (trimmed === "clear") {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.notify("context-budget: report cleared", "info");
    return;
  }
  if (trimmed === "reload") {
    const errors = deps.reload();
    if (errors.length > 0) ctx.ui.notify(`context-budget: ${errors.join("; ")}`, "warning");
  } else if (trimmed !== "" && trimmed !== "show") {
    ctx.ui.notify(USAGE, "warning");
    return;
  }
  const lines = reportLines(deps.snapshot());
  ctx.ui.setWidget(WIDGET_KEY, lines);
  ctx.ui.notify(lines.join("\n"), "info");
}
