import {
  AssistantMessageComponent,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { removeToolHorizontalPadding } from "./tool-padding.ts";
import type { FoldHistorySummary, FoldSummary } from "./turn-state.ts";
import { TurnFoldState } from "./turn-state.ts";

export type RestoreRenderPatches = () => void;

function privateString(instance: object, key: string): string | undefined {
  const value: unknown = Reflect.get(instance, key);
  return typeof value === "string" ? value : undefined;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function formatCompact(value: number, suffix: string): string {
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals).replace(/\.0$/u, "")}${suffix}`;
}

function formatTokenCount(tokens: number): string {
  const value = Math.max(0, tokens);
  if (value < 1_000) return Math.round(value).toString();
  if (value < 1_000_000) return formatCompact(value / 1_000, "K");
  return formatCompact(value / 1_000_000, "M");
}

export function formatFoldHistorySummary(summary: FoldHistorySummary): string {
  const parts = [countLabel(summary.turns, "previous turn"), countLabel(summary.messages, "msg")];
  const approximate = summary.outputApproximate ? "~" : "";
  parts.push(`${approximate}${formatTokenCount(summary.outputTokens)} out`);
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));
  return `▶ ${parts.join(" · ")} · Ctrl+Shift+O`;
}

export function formatFoldSummary(summary: FoldSummary): string {
  const parts = [countLabel(summary.tools, "tool")];
  if (summary.intermediateMessages > 0) {
    parts.push(countLabel(summary.intermediateMessages, "msg"));
  }
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));

  if (summary.running) return `◆ Working · ${parts.join(" · ")}`;
  const approximate = summary.outputApproximate ? "~" : "";
  const output = `${approximate}${formatTokenCount(summary.outputTokens)} out`;
  return `▶ Worked for ${formatDuration(summary.durationMs)} · ${output} · ${parts.join(" · ")} · Ctrl+Shift+O`;
}

export function renderFoldSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (width <= 0) return [];
  const text = truncateToWidth(formatFoldSummary(summary), width, "…");
  const styled = theme
    ? theme.fg(summary.failedTools > 0 || summary.aborted ? "warning" : "muted", text)
    : text;
  if (!summary.aborted) return ["", styled];
  const aborted = theme ? theme.fg("error", "Operation aborted") : "Operation aborted";
  return ["", styled, aborted];
}

export function renderFoldHistorySummary(
  summary: FoldHistorySummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (width <= 0) return [];
  const text = truncateToWidth(formatFoldHistorySummary(summary), width, "…");
  const styled = theme ? theme.fg(summary.failedTools > 0 ? "warning" : "muted", text) : text;
  return ["", styled];
}

export function installRenderPatches(
  state: TurnFoldState,
  getTheme: () => Theme | undefined,
): RestoreRenderPatches {
  const assistantPrototype = AssistantMessageComponent.prototype;
  const originalAssistantUpdate = assistantPrototype.updateContent;
  const originalAssistantRender = assistantPrototype.render;
  const toolPrototype = ToolExecutionComponent.prototype;
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
    if (!view || view.display === "original") return originalAssistantRender.call(this, width);
    if (view.display === "hidden") return [];
    if (view.display === "history" && view.history) {
      return renderFoldHistorySummary(view.history, width, getTheme());
    }
    return renderFoldSummary(view.summary, width, getTheme());
  };

  const patchedToolRender = function (this: ToolExecutionComponent, width: number): string[] {
    removeToolHorizontalPadding(this);
    state.reloadHistoryForNewComponent(this);
    const toolCallId = privateString(this, "toolCallId");
    if (toolCallId) state.associateTool(this, toolCallId);
    const view = state.viewFor(this);
    if (!view || view.display === "original") return originalToolRender.call(this, width);
    if (view.display === "hidden") return [];
    if (view.display === "history" && view.history) {
      return renderFoldHistorySummary(view.history, width, getTheme());
    }
    return renderFoldSummary(view.summary, width, getTheme());
  };

  assistantPrototype.updateContent = patchedAssistantUpdate;
  assistantPrototype.render = patchedAssistantRender;
  toolPrototype.render = patchedToolRender;

  return () => {
    if (assistantPrototype.updateContent === patchedAssistantUpdate) {
      assistantPrototype.updateContent = originalAssistantUpdate;
    }
    if (assistantPrototype.render === patchedAssistantRender) {
      assistantPrototype.render = originalAssistantRender;
    }
    if (toolPrototype.render === patchedToolRender) {
      toolPrototype.render = originalToolRender;
    }
  };
}
