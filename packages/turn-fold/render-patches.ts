import {
  AssistantMessageComponent,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import type { FoldSummary } from "./turn-state.ts";
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

export function formatFoldSummary(summary: FoldSummary): string {
  const parts = [countLabel(summary.tools, "tool")];
  if (summary.intermediateMessages > 0) {
    parts.push(countLabel(summary.intermediateMessages, "msg"));
  }
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));

  if (summary.running) return `◆ Working · ${parts.join(" · ")}`;
  return `▶ Worked for ${formatDuration(summary.durationMs)} · ${parts.join(" · ")} · Ctrl+Shift+O`;
}

export function renderFoldSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (width <= 0) return [];
  const text = truncateToWidth(formatFoldSummary(summary), width, "…");
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
    return renderFoldSummary(view.summary, width, getTheme());
  };

  const patchedToolRender = function (this: ToolExecutionComponent, width: number): string[] {
    const toolCallId = privateString(this, "toolCallId");
    if (toolCallId) state.associateTool(this, toolCallId);
    const view = state.viewFor(this);
    if (!view || view.display === "original") return originalToolRender.call(this, width);
    if (view.display === "hidden") return [];
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
