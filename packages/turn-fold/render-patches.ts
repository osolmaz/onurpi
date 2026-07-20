import {
  AssistantMessageComponent,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { removeToolHorizontalPadding } from "./tool-padding.ts";
import type { FoldDisplay } from "./fold-policy.ts";
import type { FoldSummary } from "./turn-state.ts";
import { TurnFoldState } from "./turn-state.ts";

export type RestoreRenderPatches = () => void;

function privateString(instance: object, key: string): string | undefined {
  const value: unknown = Reflect.get(instance, key);
  return typeof value === "string" ? value : undefined;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
}

export function formatStreamingSummary(summary: FoldSummary): string {
  const parts = [countLabel(summary.hiddenActivities, "earlier activity", "earlier activities")];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  return `▶ ${parts.join(" · ")} · Ctrl+Shift+O`;
}

export function formatSettledSummary(summary: FoldSummary): string {
  const parts = [`Worked for ${formatDuration(summary.durationMs)}`];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));
  if (summary.aborted) parts.push("interrupted");
  return `▶ ${parts.join(" · ")} · Ctrl+Shift+O`;
}

function styledSummary(
  text: string,
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (width <= 0) return [];
  const truncated = truncateToWidth(text, width, "…");
  const styled = theme
    ? theme.fg(summary.aborted || summary.failedTools > 0 ? "warning" : "muted", truncated)
    : truncated;
  return ["", styled];
}

export function renderStreamingSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return styledSummary(formatStreamingSummary(summary), summary, width, theme);
}

export function renderSettledSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return styledSummary(formatSettledSummary(summary), summary, width, theme);
}

function interruptionFallback(theme: Theme | undefined, width: number): string[] {
  if (width <= 0) return [];
  const text = truncateToWidth("Operation interrupted", width, "…");
  return ["", theme ? theme.fg("error", text) : text];
}

function settledFinal(
  original: string[],
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return original.length === 0 && summary.aborted ? interruptionFallback(theme, width) : original;
}

function settledSummaryAndFinal(
  original: string[],
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return [
    ...renderSettledSummary(summary, width, theme),
    ...settledFinal(original, summary, width, theme),
  ];
}

function renderFoldView(
  display: FoldDisplay,
  original: () => string[],
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (display === "original") return original();
  if (display === "hidden") return [];
  if (display === "streaming-summary") return renderStreamingSummary(summary, width, theme);
  if (display === "settled-summary") return renderSettledSummary(summary, width, theme);
  const originalLines = original();
  return display === "settled-summary-final"
    ? settledSummaryAndFinal(originalLines, summary, width, theme)
    : settledFinal(originalLines, summary, width, theme);
}

export function installRenderPatches(
  state: TurnFoldState,
  getTheme: () => Theme | undefined,
): RestoreRenderPatches {
  const assistantPrototype = AssistantMessageComponent.prototype;
  const originalAssistantUpdate = assistantPrototype.updateContent;
  const originalAssistantRender = assistantPrototype.render;
  const toolPrototype = ToolExecutionComponent.prototype;
  const originalToolMarkExecutionStarted = toolPrototype.markExecutionStarted;
  const originalToolRender = toolPrototype.render;

  type AssistantMessage = Parameters<AssistantMessageComponent["updateContent"]>[0];

  const patchedAssistantUpdate = function (
    this: AssistantMessageComponent,
    message: AssistantMessage,
  ): void {
    originalAssistantUpdate.call(this, message);
    state.reloadHistoryForNewComponent(this);
    state.associateAssistant(this, message);
  };

  const patchedAssistantRender = function (
    this: AssistantMessageComponent,
    width: number,
  ): string[] {
    const lastMessage: unknown = Reflect.get(this, "lastMessage");
    state.associateAssistant(this, lastMessage);
    const view = state.viewFor(this);
    if (!view) return originalAssistantRender.call(this, width);
    return renderFoldView(
      view.display,
      () => originalAssistantRender.call(this, width),
      view.summary,
      width,
      getTheme(),
    );
  };

  const patchedToolMarkExecutionStarted = function (this: ToolExecutionComponent): void {
    state.reloadHistoryForNewComponent(this);
    const toolCallId = privateString(this, "toolCallId");
    if (toolCallId) state.associateTool(this, toolCallId);
    originalToolMarkExecutionStarted.call(this);
  };

  const patchedToolRender = function (this: ToolExecutionComponent, width: number): string[] {
    removeToolHorizontalPadding(this);
    state.reloadHistoryForNewComponent(this);
    const toolCallId = privateString(this, "toolCallId");
    if (toolCallId) state.associateTool(this, toolCallId);
    const view = state.viewFor(this);
    if (!view) return originalToolRender.call(this, width);
    return renderFoldView(
      view.display,
      () => originalToolRender.call(this, width),
      view.summary,
      width,
      getTheme(),
    );
  };

  assistantPrototype.updateContent = patchedAssistantUpdate;
  assistantPrototype.render = patchedAssistantRender;
  toolPrototype.markExecutionStarted = patchedToolMarkExecutionStarted;
  toolPrototype.render = patchedToolRender;

  return () => {
    if (assistantPrototype.updateContent === patchedAssistantUpdate) {
      assistantPrototype.updateContent = originalAssistantUpdate;
    }
    if (assistantPrototype.render === patchedAssistantRender) {
      assistantPrototype.render = originalAssistantRender;
    }
    if (toolPrototype.markExecutionStarted === patchedToolMarkExecutionStarted) {
      toolPrototype.markExecutionStarted = originalToolMarkExecutionStarted;
    }
    if (toolPrototype.render === patchedToolRender) {
      toolPrototype.render = originalToolRender;
    }
  };
}
