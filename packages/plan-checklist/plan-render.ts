import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { completedPlanSteps, type PlanSnapshot, type PlanStep } from "./plan-schema.ts";

const WIDGET_STEP_LIMIT = 6;

type PlanRenderTheme = Pick<Theme, "bold" | "fg" | "italic" | "strikethrough">;

function styledStep(step: PlanStep, theme: PlanRenderTheme): string {
  if (step.status === "completed") {
    return `${theme.fg("dim", "✔")} ${theme.fg("dim", theme.strikethrough(step.step))}`;
  }
  if (step.status === "in_progress") {
    return `${theme.fg("accent", theme.bold("□"))} ${theme.fg("accent", theme.bold(step.step))}`;
  }
  return `${theme.fg("dim", "□")} ${theme.fg("dim", step.step)}`;
}

function selectedCollapsedStep(snapshot: PlanSnapshot): PlanStep | undefined {
  return (
    snapshot.plan.find((step) => step.status === "in_progress") ??
    snapshot.plan.find((step) => step.status === "pending") ??
    snapshot.plan.at(-1)
  );
}

export function renderPlanCall(explanation: string | undefined, theme: PlanRenderTheme): Text {
  let content = theme.fg("toolTitle", theme.bold("Updated Plan"));
  const trimmed = explanation?.trim();
  if (trimmed) content += `\n${theme.fg("dim", theme.italic(trimmed))}`;
  return new Text(content, 0, 0);
}

export function renderPlanResult(
  snapshot: PlanSnapshot,
  expanded: boolean,
  theme: PlanRenderTheme,
): Text {
  if (snapshot.plan.length === 0) return new Text(theme.fg("dim", "(no steps provided)"), 0, 0);

  const completed = completedPlanSteps(snapshot);
  const progress = `${String(completed)}/${String(snapshot.plan.length)} completed`;
  const lines = [theme.fg("muted", progress)];
  if (expanded) {
    lines.push(...snapshot.plan.map((step) => styledStep(step, theme)));
  } else {
    const selected = selectedCollapsedStep(snapshot);
    if (selected) lines.push(styledStep(selected, theme));
    const hidden = snapshot.plan.length - 1;
    if (hidden > 0) {
      lines.push(theme.fg("dim", `… ${String(hidden)} other ${hidden === 1 ? "step" : "steps"}`));
    }
  }
  return new Text(lines.join("\n"), 0, 0);
}

export function fallbackToolText(content: readonly { type: string; text?: string }[]): string {
  return content.find((item) => item.type === "text" && typeof item.text === "string")?.text ?? "";
}

function widgetSlice(snapshot: PlanSnapshot): readonly PlanStep[] {
  if (snapshot.plan.length <= WIDGET_STEP_LIMIT) return snapshot.plan;
  const activeIndex = snapshot.plan.findIndex((step) => step.status === "in_progress");
  const pendingIndex = snapshot.plan.findIndex((step) => step.status === "pending");
  const anchor =
    activeIndex >= 0 ? activeIndex : pendingIndex >= 0 ? pendingIndex : snapshot.plan.length - 1;
  const start = Math.max(0, Math.min(anchor - 1, snapshot.plan.length - WIDGET_STEP_LIMIT));
  return snapshot.plan.slice(start, start + WIDGET_STEP_LIMIT);
}

export function renderPlanWidgetLines(
  snapshot: PlanSnapshot,
  width: number,
  theme: PlanRenderTheme,
): string[] {
  if (width <= 0 || snapshot.plan.length === 0) return [];
  const completed = completedPlanSteps(snapshot);
  const selected = widgetSlice(snapshot);
  const progress = `Plan ${String(completed)}/${String(snapshot.plan.length)}`;
  const lines = [theme.fg("accent", theme.bold(progress))];
  lines.push(...selected.map((step) => styledStep(step, theme)));
  const hidden = snapshot.plan.length - selected.length;
  if (hidden > 0) lines.push(theme.fg("dim", `+${String(hidden)} more`));
  return lines.map((line) => {
    const truncated = truncateToWidth(line, width, "…");
    return visibleWidth(truncated) <= width ? truncated : truncateToWidth(truncated, width, "");
  });
}

export class PlanWidget {
  private cachedLines: string[] | undefined;
  private cachedWidth: number | undefined;

  constructor(
    private readonly snapshot: PlanSnapshot,
    private readonly theme: PlanRenderTheme,
  ) {}

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedLines = renderPlanWidgetLines(this.snapshot, width, this.theme);
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }
}
