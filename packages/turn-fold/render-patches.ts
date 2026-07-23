import {
  AssistantMessageComponent,
  CompactionSummaryMessageComponent,
  SkillInvocationMessageComponent,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, truncateToWidth } from "@earendil-works/pi-tui";

import { removeToolHorizontalPadding } from "./tool-padding.ts";
import { formatLocalTimestamp } from "./local-time.ts";
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

function compactionLabel(count: number): string {
  return count === 1 ? "compacted" : countLabel(count, "compaction");
}

const DURATION_UNITS = [
  ["w", 7 * 24 * 60 * 60],
  ["d", 24 * 60 * 60],
  ["h", 60 * 60],
  ["m", 60],
  ["s", 1],
] as const;

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  let remainingSeconds = Math.round(durationMs / 1_000);
  const parts: string[] = [];
  for (const [label, secondsPerUnit] of DURATION_UNITS) {
    const count = Math.floor(remainingSeconds / secondsPerUnit);
    if (count > 0) parts.push(`${String(count)}${label}`);
    remainingSeconds %= secondsPerUnit;
  }
  return parts.join(" ");
}

export function formatStreamingSummary(summary: FoldSummary): string {
  const parts = [countLabel(summary.hiddenActivities, "earlier activity", "earlier activities")];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  if (summary.compactions > 0) parts.push(compactionLabel(summary.compactions));
  return `▶ ${parts.join(" · ")}`;
}

export function formatSettledSummary(summary: FoldSummary): string {
  const parts = [`Worked for ${formatDuration(summary.durationMs)}`];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));
  if (summary.compactions > 0) parts.push(compactionLabel(summary.compactions));
  if (summary.aborted) parts.push("interrupted");
  return `▶ ${parts.join(" · ")}`;
}

function styledSummary(text: string, width: number, theme: Theme | undefined): string[] {
  if (width <= 0) return [];
  const truncated = truncateToWidth(text, width, "…");
  const styled = theme ? theme.bold(theme.fg("warning", truncated)) : truncated;
  return ["", styled];
}

export function renderStreamingSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return styledSummary(formatStreamingSummary(summary), width, theme);
}

export function renderSettledSummary(
  summary: FoldSummary,
  width: number,
  theme: Theme | undefined,
): string[] {
  return styledSummary(formatSettledSummary(summary), width, theme);
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
  const visible =
    original.length === 0 && summary.aborted ? interruptionFallback(theme, width) : original;
  return timestampAfterContent(visible, summary.completedAt, width, theme);
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

const USER_ZONE_END = "\u001b]133;B\u0007\u001b]133;C\u0007";
type TimestampBackground = "customMessageBg" | "userMessageBg";

function timestampContent(label: string, width: number, theme: Theme | undefined): string {
  const styled = theme ? theme.fg("dim", label) : label;
  return " ".repeat(Math.max(0, width - label.length)) + styled;
}

function timestampBackground(
  content: string,
  background: TimestampBackground,
  theme: Theme | undefined,
): string {
  return theme ? theme.bg(background, content) : content;
}

function timestampAfterContent(
  original: string[],
  timestamp: number | undefined,
  width: number,
  theme: Theme | undefined,
): string[] {
  if (timestamp === undefined || width <= 0 || original.length === 0) return original;
  const label = truncateToWidth(formatLocalTimestamp(timestamp), width, "");
  if (!label) return original;
  const lines = [...original];
  const lastIndex = lines.length - 1;
  const lastLine = lines[lastIndex] ?? "";
  const prefix = lastLine.startsWith(USER_ZONE_END) ? USER_ZONE_END : "";
  if (prefix) lines[lastIndex] = lastLine.slice(prefix.length);
  return [...lines, prefix + timestampContent(label, width, theme)];
}

function timestampOnBottomLine(
  original: string[],
  timestamp: number | undefined,
  width: number,
  theme: Theme | undefined,
  background: TimestampBackground,
): string[] {
  if (timestamp === undefined || width <= 0 || original.length === 0) return original;
  const label = truncateToWidth(formatLocalTimestamp(timestamp), width, "");
  if (!label) return original;
  const content = timestampContent(label, width, theme);
  const lastLine = original.at(-1) ?? "";
  const prefix = lastLine.startsWith(USER_ZONE_END) ? USER_ZONE_END : "";
  const timestampLine = timestampBackground(content, background, theme);
  return [...original.slice(0, -1), prefix + timestampLine];
}

function skillHasUserMessage(component: SkillInvocationMessageComponent): boolean {
  const skillBlock: unknown = Reflect.get(component, "skillBlock");
  if (typeof skillBlock !== "object" || skillBlock === null) return false;
  const userMessage: unknown = Reflect.get(skillBlock, "userMessage");
  return typeof userMessage === "string" && userMessage.trim().length > 0;
}

function isUserRow(component: object): boolean {
  return (
    component instanceof UserMessageComponent ||
    component instanceof SkillInvocationMessageComponent
  );
}

function installUserSpacingPatches(state: TurnFoldState): RestoreRenderPatches {
  const suppressedSpacers = new WeakSet();
  const compactionBySpacer = new WeakMap<Spacer, CompactionSummaryMessageComponent>();
  const containerPrototype = Container.prototype;
  const originalAddChild = containerPrototype.addChild;
  const spacerPrototype = Spacer.prototype;
  const originalSpacerRender = spacerPrototype.render;
  type Child = Parameters<Container["addChild"]>[0];

  const patchedAddChild = function (this: Container, component: Child): void {
    const previous = this.children.at(-1);
    if (previous instanceof Spacer && isUserRow(component)) suppressedSpacers.add(previous);
    if (previous instanceof Spacer && component instanceof CompactionSummaryMessageComponent) {
      state.reloadHistoryForNewComponent(component);
      const message: unknown = Reflect.get(component, "message");
      state.associateCompaction(component, message);
      compactionBySpacer.set(previous, component);
    }
    originalAddChild.call(this, component);
  };
  const patchedSpacerRender = function (this: Spacer, width: number): string[] {
    if (suppressedSpacers.has(this)) return [];
    const compaction = compactionBySpacer.get(this);
    const compactionDisplay = compaction ? state.viewFor(compaction)?.display : undefined;
    return compactionDisplay && compactionDisplay !== "original"
      ? []
      : originalSpacerRender.call(this, width);
  };

  containerPrototype.addChild = patchedAddChild;
  spacerPrototype.render = patchedSpacerRender;
  return () => {
    if (containerPrototype.addChild === patchedAddChild) {
      containerPrototype.addChild = originalAddChild;
    }
    if (spacerPrototype.render === patchedSpacerRender)
      spacerPrototype.render = originalSpacerRender;
  };
}

function installUserTimestampPatches(
  state: TurnFoldState,
  getTheme: () => Theme | undefined,
): RestoreRenderPatches {
  const restoreUserSpacing = installUserSpacingPatches(state);
  const userPrototype = UserMessageComponent.prototype;
  const originalUserRender = userPrototype.render;
  const skillPrototype = SkillInvocationMessageComponent.prototype;
  const originalSkillRender = skillPrototype.render;

  const patchedUserRender = function (this: UserMessageComponent, width: number): string[] {
    state.reloadHistoryForNewComponent(this);
    state.associateUser(this);
    return timestampOnBottomLine(
      originalUserRender.call(this, width),
      state.userTimestampFor(this),
      width,
      getTheme(),
      "userMessageBg",
    );
  };
  const patchedSkillRender = function (
    this: SkillInvocationMessageComponent,
    width: number,
  ): string[] {
    const original = originalSkillRender.call(this, width);
    if (skillHasUserMessage(this)) return original;
    state.reloadHistoryForNewComponent(this);
    state.associateUser(this);
    return timestampOnBottomLine(
      original,
      state.userTimestampFor(this),
      width,
      getTheme(),
      "customMessageBg",
    );
  };

  userPrototype.render = patchedUserRender;
  skillPrototype.render = patchedSkillRender;
  return () => {
    restoreUserSpacing();
    if (userPrototype.render === patchedUserRender) userPrototype.render = originalUserRender;
    if (skillPrototype.render === patchedSkillRender) skillPrototype.render = originalSkillRender;
  };
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

function installCompactionRenderPatch(
  state: TurnFoldState,
  getTheme: () => Theme | undefined,
): RestoreRenderPatches {
  const prototype = CompactionSummaryMessageComponent.prototype;
  const hadOwnRender = Object.prototype.hasOwnProperty.call(prototype, "render");
  const originalRender = prototype.render;
  const patchedRender = function (
    this: CompactionSummaryMessageComponent,
    width: number,
  ): string[] {
    state.reloadHistoryForNewComponent(this);
    const message: unknown = Reflect.get(this, "message");
    state.associateCompaction(this, message);
    const view = state.viewFor(this);
    if (!view) return originalRender.call(this, width);
    return renderFoldView(
      view.display,
      () => originalRender.call(this, width),
      view.summary,
      width,
      getTheme(),
    );
  };

  prototype.render = patchedRender;
  return () => {
    if (prototype.render !== patchedRender) return;
    if (hadOwnRender) prototype.render = originalRender;
    else Reflect.deleteProperty(prototype, "render");
  };
}

export function installRenderPatches(
  state: TurnFoldState,
  getTheme: () => Theme | undefined,
): RestoreRenderPatches {
  const restoreUserTimestamps = installUserTimestampPatches(state, getTheme);
  const restoreCompactionRender = installCompactionRenderPatch(state, getTheme);
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
    restoreUserTimestamps();
    restoreCompactionRender();
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
