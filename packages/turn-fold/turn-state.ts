import { foldDisplay, type FoldDisplay } from "./fold-policy.ts";
import { nextTurnFoldMode, type TurnFoldMode } from "./mode.ts";

const LIVE_ACTIVITY_LIMIT = 3;

type ComponentKind = "assistant" | "tool";

type AssistantSnapshot = {
  aborted: boolean;
  hasVisibleContent: boolean;
  key: string;
  timestamp: number;
  toolCallIds: string[];
};

type ComponentInfo = {
  kind: ComponentKind;
  sequence: number;
};

type TurnGroup = {
  assistantKeys: Set<string>;
  assistants: Map<object, AssistantSnapshot>;
  components: Map<object, ComponentInfo>;
  endedAt?: number;
  id: string;
  settled: boolean;
  startedAt: number;
  startedByUser: boolean;
  toolCallIds: Set<string>;
  tools: Map<object, string>;
};

export type ComponentView = {
  display: FoldDisplay;
};

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
  hasVisibleContent: boolean;
  toolCallIds: string[];
} {
  let hasVisibleContent = false;
  const toolCallIds: string[] = [];
  for (const item of items) {
    if (hasNonBlankContent(item, "text", "text")) hasVisibleContent = true;
    if (hasNonBlankContent(item, "thinking", "thinking")) hasVisibleContent = true;
    const toolCallId =
      stringField(item, "type") === "toolCall" ? stringField(item, "id") : undefined;
    if (toolCallId) toolCallIds.push(toolCallId);
  }
  return { hasVisibleContent, toolCallIds };
}

function assistantSnapshot(message: unknown): AssistantSnapshot | undefined {
  if (stringField(message, "role") !== "assistant") return undefined;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === undefined) return undefined;

  const { hasVisibleContent, toolCallIds } = summarizeAssistantContent(contentItems(message));
  const responseId = stringField(message, "responseId") ?? "";
  return {
    aborted: stringField(message, "stopReason") === "aborted",
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
  private groups = new Map<string, TurnGroup>();
  private historyReload: (() => readonly unknown[]) | undefined;
  private mode: TurnFoldMode = "compact";
  private sequence = 0;
  private toolGroupById = new Map<string, string>();

  getMode(): TurnFoldMode {
    return this.mode;
  }

  setMode(mode: TurnFoldMode): void {
    this.mode = mode;
  }

  toggleExpanded(): TurnFoldMode {
    this.mode = nextTurnFoldMode(this.mode);
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

    if (activeGroup) this.settleActive(startedAt);
    const group = this.createGroup(startedAt, false, true);
    this.activeGroupId = group.id;
    return group.id;
  }

  registerAssistantMessage(message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    const groupId = this.ensureActive(snapshot.timestamp);
    const group = this.groups.get(groupId);
    group?.assistantKeys.add(snapshot.key);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      group?.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, groupId);
    }
  }

  registerToolStart(toolCallId: string, startedAt = Date.now()): void {
    const groupId = this.ensureActive(startedAt);
    this.groups.get(groupId)?.toolCallIds.add(toolCallId);
    this.toolGroupById.set(toolCallId, groupId);
  }

  associateAssistant(component: object, message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    const previousComponent = this.assistantComponentByKey.get(snapshot.key);
    if (previousComponent && previousComponent !== component) this.resetComponentAssociations();
    this.assistantComponentByKey.set(snapshot.key, component);
    const groupId = this.assistantGroupByKey.get(snapshot.key) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;

    this.associateComponent(component, group, "assistant");
    group.assistants.set(component, snapshot);
  }

  associateTool(component: object, toolCallId: string): void {
    const groupId = this.toolGroupById.get(toolCallId) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;

    this.associateComponent(component, group, "tool");
    group.tools.set(component, toolCallId);
  }

  settleActive(endedAt = Date.now()): void {
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.settled = true;
      group.endedAt = endedAt;
    }
    this.activeGroupId = undefined;
  }

  abortActive(endedAt = Date.now()): void {
    this.settleActive(endedAt);
  }

  viewFor(component: object): ComponentView | undefined {
    const groupId = this.componentInfo.get(component)?.groupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return undefined;

    const display = foldDisplay({
      isLastAssistant: component === this.lastAssistant(group),
      isRecentActivity: this.isRecentActivity(group, component),
      mode: this.mode,
      settled: group.settled,
    });
    return { display };
  }

  private groupHasActivity(group: TurnGroup): boolean {
    return group.assistantKeys.size > 0 || group.toolCallIds.size > 0;
  }

  private activityComponents(group: TurnGroup): [object, ComponentInfo][] {
    return [...group.components]
      .filter(
        ([candidate, info]) =>
          info.kind === "tool" || group.assistants.get(candidate)?.hasVisibleContent === true,
      )
      .sort(([, left], [, right]) => right.sequence - left.sequence);
  }

  private isRecentActivity(group: TurnGroup, component: object): boolean {
    return this.activityComponents(group)
      .slice(0, LIVE_ACTIVITY_LIMIT)
      .some(([candidate]) => candidate === component);
  }

  private lastAssistant(group: TurnGroup): object | undefined {
    const candidates = [...group.assistants]
      .filter(([, snapshot]) => snapshot.hasVisibleContent || snapshot.aborted)
      .map(([component]) => component);
    return latestBySequence(group.components, candidates);
  }

  private associateComponent(component: object, group: TurnGroup, kind: ComponentKind): void {
    if (this.componentInfo.has(component)) return;
    this.sequence += 1;
    const info = { kind, sequence: this.sequence };
    group.components.set(component, info);
    this.componentInfo.set(component, { groupId: group.id, sequence: info.sequence });
  }

  private createGroup(startedAt: number, settled: boolean, startedByUser = false): TurnGroup {
    this.groupCounter += 1;
    const group: TurnGroup = {
      assistantKeys: new Set(),
      assistants: new Map(),
      components: new Map(),
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
    if (role === "assistant") this.indexHistoricalAssistant(group, message);
    if (role === "toolResult") this.indexHistoricalToolResult(group, message);
  }

  private indexHistoricalAssistant(group: TurnGroup, message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    group.assistantKeys.add(snapshot.key);
    this.assistantGroupByKey.set(snapshot.key, group.id);
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
    const timestamp = numberField(message, "timestamp");
    if (timestamp !== undefined) group.endedAt = Math.max(group.endedAt ?? 0, timestamp);
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
  }

  private resetGroups(): void {
    this.activeGroupId = undefined;
    this.assistantComponentByKey = new Map();
    this.assistantGroupByKey = new Map();
    this.componentInfo = new WeakMap();
    this.groups = new Map();
    this.groupCounter = 0;
    this.historyReload = undefined;
    this.sequence = 0;
    this.toolGroupById = new Map();
  }

  private reloadHistory(entries: readonly unknown[]): void {
    const activeGroupId = this.activeGroupId;
    const activeGroup = activeGroupId ? this.groups.get(activeGroupId) : undefined;
    this.loadHistory(entries);
    if (!activeGroupId || !activeGroup) return;

    const visibleGroups = [...this.groups.values()];
    const activeGroups = this.reloadedActiveGroups(visibleGroups, activeGroup);
    this.mergeVisibleActiveGroups(activeGroup, activeGroups);
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    for (const group of activeGroups) this.groups.delete(group.id);
    this.groups.set(activeGroup.id, activeGroup);
    this.reassignGroupIds(activeGroupIds, activeGroup.id);
    this.groupCounter = Math.max(this.groupCounter, groupNumber(activeGroup.id));
    this.activeGroupId = activeGroup.id;
  }

  private reloadedActiveGroups(
    visibleGroups: readonly TurnGroup[],
    activeGroup: TurnGroup,
  ): readonly TurnGroup[] {
    const matchingGroup = visibleGroups.findIndex(
      (group) =>
        [...group.assistantKeys].some((key) => activeGroup.assistantKeys.has(key)) ||
        [...group.toolCallIds].some((id) => activeGroup.toolCallIds.has(id)) ||
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
      active.assistantKeys = new Set([...active.assistantKeys, ...visible.assistantKeys]);
      active.toolCallIds = new Set([...active.toolCallIds, ...visible.toolCallIds]);
    }
  }

  private reassignGroupIds(fromGroupIds: ReadonlySet<string>, toGroupId: string): void {
    for (const [key, groupId] of this.assistantGroupByKey) {
      if (fromGroupIds.has(groupId)) this.assistantGroupByKey.set(key, toGroupId);
    }
    for (const [key, groupId] of this.toolGroupById) {
      if (fromGroupIds.has(groupId)) this.toolGroupById.set(key, toGroupId);
    }
  }
}
