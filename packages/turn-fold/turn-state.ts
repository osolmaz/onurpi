import { foldDisplay, type FoldDisplay } from "./fold-policy.ts";
import type { TurnFoldMode } from "./mode.ts";
import {
  combineOutputTotals,
  deriveAssistantOutput,
  type OutputTokenTotal,
} from "./output-metrics.ts";

const RECENT_SETTLED_TURN_COUNT = 3;

type ComponentKind = "assistant" | "tool";

type AssistantSnapshot = {
  aborted: boolean;
  hasText: boolean;
  hasToolCalls: boolean;
  hasVisibleContent: boolean;
  key: string;
  timestamp: number;
  toolCallIds: string[];
};

type ComponentInfo = {
  kind: ComponentKind;
  sequence: number;
};

type CollapsedHistory = {
  anchor: object | undefined;
  groupIds: ReadonlySet<string>;
  summary: FoldHistorySummary;
};

type TurnGroup = {
  aborted: boolean;
  assistants: Map<object, AssistantSnapshot>;
  components: Map<object, ComponentInfo>;
  endedAt?: number;
  failedToolCallIds: Set<string>;
  finalizedAssistantOutputs: Map<string, OutputTokenTotal>;
  id: string;
  settled: boolean;
  startedAt: number;
  startedByUser: boolean;
  toolCallIds: Set<string>;
  tools: Map<object, string>;
};

export type FoldSummary = {
  aborted: boolean;
  durationMs: number;
  failedTools: number;
  intermediateMessages: number;
  outputApproximate: boolean;
  outputTokens: number;
  running: boolean;
  tools: number;
};

export type FoldHistorySummary = {
  failedTools: number;
  messages: number;
  outputApproximate: boolean;
  outputTokens: number;
  tools: number;
  turns: number;
};

export type ComponentView = {
  display: FoldDisplay;
  history?: FoldHistorySummary;
  summary: FoldSummary;
};

const LIVE_ACTIVITY_LIMIT = 3;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function contentItems(message: unknown): readonly unknown[] {
  if (!isRecord(message)) return [];
  return Array.isArray(message["content"]) ? message["content"] : [];
}

function hasNonBlankContent(value: unknown, type: string, key: string): boolean {
  if (stringField(value, "type") !== type) return false;
  return Boolean(stringField(value, key)?.trim());
}

function summarizeAssistantContent(items: readonly unknown[]): {
  hasText: boolean;
  hasVisibleContent: boolean;
  toolCallIds: string[];
} {
  let hasText = false;
  let hasVisibleContent = false;
  const toolCallIds: string[] = [];
  for (const item of items) {
    const type = stringField(item, "type");
    if (hasNonBlankContent(item, "text", "text")) {
      hasText = true;
      hasVisibleContent = true;
    }
    if (hasNonBlankContent(item, "thinking", "thinking")) hasVisibleContent = true;
    const toolCallId = type === "toolCall" ? stringField(item, "id") : undefined;
    if (toolCallId) toolCallIds.push(toolCallId);
  }
  return { hasText, hasVisibleContent, toolCallIds };
}

function assistantSnapshot(message: unknown): AssistantSnapshot | undefined {
  if (stringField(message, "role") !== "assistant") return undefined;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === undefined) return undefined;

  const { hasText, hasVisibleContent, toolCallIds } = summarizeAssistantContent(
    contentItems(message),
  );
  const responseId = stringField(message, "responseId") ?? "";
  return {
    aborted: stringField(message, "stopReason") === "aborted",
    hasText,
    hasToolCalls: toolCallIds.length > 0,
    hasVisibleContent,
    key: `${String(timestamp)}:${responseId}:${toolCallIds.join(",")}`,
    timestamp,
    toolCallIds,
  };
}

function messageFromEntry(entry: unknown): unknown {
  if (!isRecord(entry) || entry["type"] !== "message") return undefined;
  return entry["message"];
}

function latestBySequence(
  components: Map<object, ComponentInfo>,
  candidates: readonly object[],
): object | undefined {
  return candidates.reduce<object | undefined>((latest, candidate) => {
    if (!latest) return candidate;
    const currentSequence = components.get(candidate)?.sequence ?? -1;
    const latestSequence = components.get(latest)?.sequence ?? -1;
    return currentSequence > latestSequence ? candidate : latest;
  }, undefined);
}

function groupNumber(id: string): number {
  const value = Number(id.slice("turn-".length));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class TurnFoldState {
  private activeGroupId: string | undefined;
  private assistantComponentByKey = new Map<string, object>();
  private assistantGroupByKey = new Map<string, string>();
  private componentInfo = new WeakMap<object, { groupId: string; sequence: number }>();
  private groupCounter = 0;
  private historyCache: CollapsedHistory | undefined;
  private historyReload: (() => readonly unknown[]) | undefined;
  private groups = new Map<string, TurnGroup>();
  private mode: TurnFoldMode = "live";
  private pendingFinalAssistants = new Map<object, string>();
  private previousCompactMode: Exclude<TurnFoldMode, "expanded"> = "live";
  private sequence = 0;
  private toolGroupById = new Map<string, string>();

  getMode(): TurnFoldMode {
    return this.mode;
  }

  setMode(mode: TurnFoldMode): void {
    this.mode = mode;
    if (mode !== "expanded") this.previousCompactMode = mode;
    this.invalidateHistory();
  }

  toggleExpanded(): TurnFoldMode {
    this.setMode(this.mode === "expanded" ? this.previousCompactMode : "expanded");
    return this.mode;
  }

  loadHistory(entries: readonly unknown[]): void {
    this.resetGroups();
    let currentGroup: TurnGroup | undefined;
    for (const entry of entries) {
      const message = messageFromEntry(entry);
      const role = stringField(message, "role");
      if (role === "user") {
        currentGroup = this.createGroup(
          numberField(message, "timestamp") ?? Date.now(),
          true,
          true,
        );
      } else {
        currentGroup = this.historicalGroup(currentGroup, role, message);
        if (currentGroup) this.indexHistoricalMessage(currentGroup, message);
      }
    }
  }

  deferHistoryReload(entries: () => readonly unknown[]): void {
    this.historyReload = entries;
  }

  reloadHistoryForNewComponent(component: object): void {
    if (!this.historyReload || this.componentInfo.has(component)) return;
    const entries = this.historyReload;
    this.historyReload = undefined;
    this.reloadHistory(entries());
  }

  ensureActive(startedAt = Date.now()): string {
    if (this.activeGroupId) return this.activeGroupId;
    const group = this.createGroup(startedAt, false);
    this.activeGroupId = group.id;
    return group.id;
  }

  startUserTurn(startedAt = Date.now()): string {
    const activeGroup = this.activeGroupId ? this.groups.get(this.activeGroupId) : undefined;
    if (activeGroup && !activeGroup.startedByUser && !this.groupHasActivity(activeGroup)) {
      activeGroup.startedAt = startedAt;
      activeGroup.startedByUser = true;
      return activeGroup.id;
    }

    if (activeGroup) this.finishActive(false, startedAt);
    const group = this.createGroup(startedAt, false, true);
    this.activeGroupId = group.id;
    return group.id;
  }

  registerAssistantMessage(message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    const groupId = this.ensureActive(snapshot.timestamp);
    const group = this.groups.get(groupId);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      group?.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, groupId);
    }
  }

  queueFinalAssistant(message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot || !isRecord(message)) return;
    const groupId = this.assistantGroupByKey.get(snapshot.key) ?? this.activeGroupId;
    if (!groupId || !this.groups.has(groupId)) return;
    this.pendingFinalAssistants.set(message, groupId);
  }

  finalizeAssistantOutputs(entries: readonly unknown[]): void {
    if (this.pendingFinalAssistants.size === 0) return;
    const finalizedMessages = entries
      .map(messageFromEntry)
      .filter((message) => stringField(message, "role") === "assistant")
      .slice(-this.pendingFinalAssistants.size);
    const groupIds = [...this.pendingFinalAssistants.values()];

    for (const [index, message] of finalizedMessages.entries()) {
      const snapshot = assistantSnapshot(message);
      const groupId = groupIds[index];
      const group = groupId ? this.groups.get(groupId) : undefined;
      if (!snapshot || !group) continue;
      this.assistantGroupByKey.set(snapshot.key, group.id);
      group.finalizedAssistantOutputs.set(snapshot.key, deriveAssistantOutput(message));
    }
    this.pendingFinalAssistants.clear();
    this.invalidateHistory();
  }

  registerToolStart(toolCallId: string, startedAt = Date.now()): void {
    const groupId = this.ensureActive(startedAt);
    this.groups.get(groupId)?.toolCallIds.add(toolCallId);
    this.toolGroupById.set(toolCallId, groupId);
  }

  registerToolEnd(toolCallId: string, failed: boolean): void {
    const groupId = this.toolGroupById.get(toolCallId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (group && failed) group.failedToolCallIds.add(toolCallId);
  }

  associateAssistant(component: object, message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    const previousComponent = this.assistantComponentByKey.get(snapshot.key);
    if (previousComponent && previousComponent !== component) this.resetComponentAssociations();
    this.assistantComponentByKey.set(snapshot.key, component);
    const groupId = this.assistantGroupByKey.get(snapshot.key) ?? this.activeGroupId;
    if (!groupId) return;
    const group = this.groups.get(groupId);
    if (!group) return;

    this.associateComponent(component, group, "assistant");
    group.assistants.set(component, snapshot);
  }

  associateTool(component: object, toolCallId: string): void {
    const groupId = this.toolGroupById.get(toolCallId) ?? this.activeGroupId;
    if (!groupId) return;
    const group = this.groups.get(groupId);
    if (!group) return;

    this.associateComponent(component, group, "tool");
    group.tools.set(component, toolCallId);
  }

  settleActive(endedAt = Date.now()): void {
    this.finishActive(false, endedAt);
  }

  abortActive(endedAt = Date.now()): void {
    this.finishActive(true, endedAt);
  }

  private groupHasActivity(group: TurnGroup): boolean {
    return (
      group.assistants.size > 0 ||
      group.finalizedAssistantOutputs.size > 0 ||
      group.toolCallIds.size > 0 ||
      [...this.assistantGroupByKey.values()].some((groupId) => groupId === group.id)
    );
  }

  private finishActive(aborted: boolean, endedAt: number): void {
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.aborted = aborted;
      group.settled = true;
      group.endedAt = endedAt;
    }
    this.activeGroupId = undefined;
    this.invalidateHistory();
  }

  viewFor(component: object, now = Date.now()): ComponentView | undefined {
    const groupId = this.componentInfo.get(component)?.groupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return undefined;

    const collapsedHistory = this.collapsedHistory();
    if (collapsedHistory.groupIds.has(group.id)) {
      const summary = this.summary(group, this.finalAssistant(group), now);
      return {
        display: component === collapsedHistory.anchor ? "history" : "hidden",
        ...(component === collapsedHistory.anchor ? { history: collapsedHistory.summary } : {}),
        summary,
      };
    }

    const finalAssistant = this.finalAssistant(group);
    const anchor = this.foldAnchor(group, finalAssistant);
    const display = foldDisplay({
      isAnchor: component === anchor,
      isFinalAssistant: component === finalAssistant,
      isRecentActivity: this.isRecentActivity(group, component),
      aborted: group.aborted,
      mode: this.mode,
      settled: group.settled,
    });

    return {
      display,
      summary: this.summary(group, finalAssistant, now),
    };
  }

  private collapsedHistory(): CollapsedHistory {
    if (this.historyCache) return this.historyCache;

    const completedGroups =
      this.mode === "expanded"
        ? []
        : [...this.groups.values()].filter(
            (group) => group.settled && group.finalizedAssistantOutputs.size > 0,
          );
    const groups = completedGroups.slice(0, -RECENT_SETTLED_TURN_COUNT);
    this.historyCache = {
      anchor: this.historyAnchor(groups),
      groupIds: new Set(groups.map((group) => group.id)),
      summary: this.historySummary(groups),
    };
    return this.historyCache;
  }

  private historyAnchor(groups: readonly TurnGroup[]): object | undefined {
    for (const group of groups) {
      const anchor = [...group.components]
        .sort(([, left], [, right]) => left.sequence - right.sequence)
        .at(0)?.[0];
      if (anchor) return anchor;
    }
    return undefined;
  }

  private historySummary(groups: readonly TurnGroup[]): FoldHistorySummary {
    const output = combineOutputTotals(
      groups.flatMap((group) => [...group.finalizedAssistantOutputs.values()]),
    );
    return {
      failedTools: groups.reduce((total, group) => total + group.failedToolCallIds.size, 0),
      messages: groups.reduce((total, group) => total + group.finalizedAssistantOutputs.size, 0),
      outputApproximate: output.approximate,
      outputTokens: output.tokens,
      tools: groups.reduce((total, group) => total + group.toolCallIds.size, 0),
      turns: groups.length,
    };
  }

  private updateHistoryAnchor(component: object, groupId: string, sequence: number): void {
    const history = this.historyCache;
    if (!history?.groupIds.has(groupId)) return;
    const anchor = history.anchor;
    const anchorInfo = anchor ? this.componentInfo.get(anchor) : undefined;
    if (anchorInfo !== undefined && anchorInfo.sequence <= sequence) return;
    this.historyCache = { ...history, anchor: component };
  }

  private invalidateHistory(): void {
    this.historyCache = undefined;
  }

  private resetComponentAssociations(): void {
    this.assistantComponentByKey = new Map();
    this.componentInfo = new WeakMap();
    this.sequence = 0;
    for (const group of this.groups.values()) {
      group.assistants.clear();
      group.components.clear();
      group.tools.clear();
    }
    this.invalidateHistory();
  }

  private resetGroups(): void {
    this.activeGroupId = undefined;
    this.assistantComponentByKey = new Map();
    this.assistantGroupByKey = new Map();
    this.componentInfo = new WeakMap();
    this.groups = new Map();
    this.groupCounter = 0;
    this.historyCache = undefined;
    this.historyReload = undefined;
    this.pendingFinalAssistants = new Map();
    this.sequence = 0;
    this.toolGroupById = new Map();
  }

  private reloadHistory(entries: readonly unknown[]): void {
    const activeGroupId = this.activeGroupId;
    const activeGroup = activeGroupId ? this.groups.get(activeGroupId) : undefined;
    const activeAssistantKeys = this.keysForGroup(this.assistantGroupByKey, activeGroupId);
    const activeToolCallIds = this.keysForGroup(this.toolGroupById, activeGroupId);
    const pendingFinalAssistants = new Map(
      [...this.pendingFinalAssistants].filter(([, groupId]) => groupId === activeGroupId),
    );
    this.loadHistory(entries);
    if (!activeGroupId || !activeGroup) return;

    const visibleGroups = [...this.groups.values()];
    const activeGroups = this.reloadedActiveGroups(
      visibleGroups,
      activeGroup,
      activeAssistantKeys,
      activeToolCallIds,
    );
    this.mergeVisibleActiveGroups(activeGroup, activeGroups);
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    for (const group of activeGroups) this.groups.delete(group.id);
    this.groups.set(activeGroup.id, activeGroup);
    this.reassignGroupIds(activeGroupIds, activeGroup.id);
    this.groupCounter = Math.max(this.groupCounter, groupNumber(activeGroup.id));
    this.activeGroupId = activeGroup.id;
    this.pendingFinalAssistants = pendingFinalAssistants;
  }

  private reloadedActiveGroups(
    visibleGroups: readonly TurnGroup[],
    activeGroup: TurnGroup,
    activeAssistantKeys: ReadonlySet<string>,
    activeToolCallIds: ReadonlySet<string>,
  ): readonly TurnGroup[] {
    const matchingGroup = visibleGroups.findIndex(
      (group) =>
        [...group.finalizedAssistantOutputs.keys()].some((key) => activeAssistantKeys.has(key)) ||
        [...group.toolCallIds].some((id) => activeToolCallIds.has(id)) ||
        (group.endedAt ?? -Infinity) >= activeGroup.startedAt,
    );
    if (matchingGroup >= 0) return visibleGroups.slice(matchingGroup);
    const lastGroup = visibleGroups.at(-1);
    return lastGroup ? [lastGroup] : [];
  }

  private mergeVisibleActiveGroups(active: TurnGroup, visibleGroups: readonly TurnGroup[]): void {
    active.assistants.clear();
    active.components.clear();
    active.tools.clear();
    for (const visible of visibleGroups) {
      active.failedToolCallIds = new Set([
        ...active.failedToolCallIds,
        ...visible.failedToolCallIds,
      ]);
      active.finalizedAssistantOutputs = new Map([
        ...active.finalizedAssistantOutputs,
        ...visible.finalizedAssistantOutputs,
      ]);
      active.toolCallIds = new Set([...active.toolCallIds, ...visible.toolCallIds]);
    }
  }

  private keysForGroup(
    values: ReadonlyMap<string, string>,
    groupId: string | undefined,
  ): Set<string> {
    return new Set([...values].flatMap(([key, value]) => (value === groupId ? [key] : [])));
  }

  private reassignGroupIds(fromGroupIds: ReadonlySet<string>, toGroupId: string): void {
    for (const [key, groupId] of this.assistantGroupByKey) {
      if (fromGroupIds.has(groupId)) this.assistantGroupByKey.set(key, toGroupId);
    }
    for (const [key, groupId] of this.toolGroupById) {
      if (fromGroupIds.has(groupId)) this.toolGroupById.set(key, toGroupId);
    }
  }

  private historicalGroup(
    currentGroup: TurnGroup | undefined,
    role: string | undefined,
    message: unknown,
  ): TurnGroup | undefined {
    if (currentGroup) return currentGroup;
    if (role !== "assistant" && role !== "toolResult") return undefined;
    return this.createGroup(numberField(message, "timestamp") ?? Date.now(), true);
  }

  private indexHistoricalMessage(group: TurnGroup, message: unknown): void {
    const role = stringField(message, "role");
    if (role === "assistant") {
      this.indexHistoricalAssistant(group, message);
    } else if (role === "toolResult") {
      this.indexHistoricalToolResult(group, message);
    }
  }

  private indexHistoricalAssistant(group: TurnGroup, message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    this.assistantGroupByKey.set(snapshot.key, group.id);
    group.finalizedAssistantOutputs.set(snapshot.key, deriveAssistantOutput(message));
    if (snapshot.aborted) group.aborted = true;
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    group.endedAt = Math.max(group.endedAt ?? 0, snapshot.timestamp);
  }

  private indexHistoricalToolResult(group: TurnGroup, message: unknown): void {
    const toolCallId = stringField(message, "toolCallId");
    if (toolCallId) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    if (toolCallId && isRecord(message) && message["isError"] === true) {
      group.failedToolCallIds.add(toolCallId);
    }
    const timestamp = numberField(message, "timestamp");
    if (timestamp !== undefined) {
      group.endedAt = Math.max(group.endedAt ?? 0, timestamp);
    }
  }

  private associateComponent(component: object, group: TurnGroup, kind: ComponentKind): void {
    if (this.componentInfo.has(component)) return;
    this.sequence += 1;
    const info = { kind, sequence: this.sequence };
    group.components.set(component, info);
    this.componentInfo.set(component, { groupId: group.id, sequence: info.sequence });
    this.updateHistoryAnchor(component, group.id, info.sequence);
  }

  private createGroup(startedAt: number, settled: boolean, startedByUser = false): TurnGroup {
    this.groupCounter += 1;
    const group: TurnGroup = {
      aborted: false,
      assistants: new Map(),
      components: new Map(),
      failedToolCallIds: new Set(),
      finalizedAssistantOutputs: new Map(),
      id: `turn-${String(this.groupCounter)}`,
      settled,
      startedAt,
      startedByUser,
      toolCallIds: new Set(),
      tools: new Map(),
    };
    this.groups.set(group.id, group);
    return group;
  }

  private finalAssistant(group: TurnGroup): object | undefined {
    const abortedAssistants = [...group.assistants]
      .filter(([, snapshot]) => snapshot.aborted)
      .map(([component]) => component);
    if (abortedAssistants.length > 0) {
      return latestBySequence(group.components, abortedAssistants);
    }

    const assistantsWithText = [...group.assistants]
      .filter(([, snapshot]) => snapshot.hasText)
      .map(([component]) => component);
    const withoutTools = assistantsWithText.filter(
      (component) => !group.assistants.get(component)?.hasToolCalls,
    );
    return latestBySequence(
      group.components,
      withoutTools.length > 0 ? withoutTools : assistantsWithText,
    );
  }

  private isRecentActivity(group: TurnGroup, component: object): boolean {
    const recentComponents = [...group.components]
      .filter(
        ([candidate, info]) =>
          info.kind === "tool" || group.assistants.get(candidate)?.hasVisibleContent === true,
      )
      .sort(([, left], [, right]) => right.sequence - left.sequence)
      .slice(0, LIVE_ACTIVITY_LIMIT);
    return recentComponents.some(([candidate]) => candidate === component);
  }

  private foldAnchor(group: TurnGroup, finalAssistant: object | undefined): object | undefined {
    const firstIntermediate = [...group.components]
      .filter(([component]) => component !== finalAssistant)
      .sort(([, left], [, right]) => left.sequence - right.sequence)
      .at(0)?.[0];
    return firstIntermediate ?? (group.aborted ? finalAssistant : undefined);
  }

  private summary(group: TurnGroup, finalAssistant: object | undefined, now: number): FoldSummary {
    const intermediateMessages = [...group.assistants].filter(
      ([component, snapshot]) => component !== finalAssistant && snapshot.hasText,
    ).length;
    const output = combineOutputTotals([...group.finalizedAssistantOutputs.values()]);
    return {
      aborted: group.aborted,
      durationMs: Math.max(0, (group.endedAt ?? now) - group.startedAt),
      failedTools: group.failedToolCallIds.size,
      intermediateMessages,
      outputApproximate: output.approximate,
      outputTokens: output.tokens,
      running: !group.settled,
      tools: group.toolCallIds.size,
    };
  }
}
