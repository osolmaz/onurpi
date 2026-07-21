import {
  compactionMetadataById,
  type CompactionMetadata,
  type CompactionReason,
} from "./compaction-metadata.ts";
import { foldDisplay, type FoldDisplay } from "./fold-policy.ts";
import { nextTurnFoldMode, type TurnFoldMode } from "./mode.ts";

const LIVE_ACTIVITY_LIMIT = 3;

type ComponentKind = "assistant" | "compaction" | "tool";

type AssistantSnapshot = {
  hasTerminalNotice: boolean;
  hasVisibleContent: boolean;
  interrupted: boolean;
  key: string;
  terminalErrorToolCallIds: string[];
  timestamp: number;
  toolCallIds: string[];
};

type ComponentInfo = {
  kind: ComponentKind;
  sequence: number;
};

type TurnGroup = {
  aborted: boolean;
  assistantKeys: Set<string>;
  assistants: Map<object, AssistantSnapshot>;
  compactionIds: Set<string>;
  compactionTimestamps: Set<number>;
  components: Map<object, ComponentInfo>;
  endedAt?: number;
  failedToolCallIds: Set<string>;
  id: string;
  settled: boolean;
  startedAt: number;
  startedByUser: boolean;
  terminalErrorToolCallIds: Set<string>;
  toolCallIds: Set<string>;
  tools: Map<object, string>;
};

export type FoldSummary = {
  aborted: boolean;
  compactions: number;
  completedAt: number | undefined;
  durationMs: number;
  failedTools: number;
  hiddenActivities: number;
  messages: number;
  running: boolean;
  tools: number;
};

export type ComponentView = {
  display: FoldDisplay;
  summary: FoldSummary;
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

function assistantSnapshot(message: unknown, key: string): AssistantSnapshot | undefined {
  if (stringField(message, "role") !== "assistant") return undefined;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === undefined) return undefined;

  const { hasVisibleContent, toolCallIds } = summarizeAssistantContent(contentItems(message));
  const stopReason = stringField(message, "stopReason");
  return {
    hasTerminalNotice:
      stopReason === "aborted" ||
      stopReason === "length" ||
      (stopReason === "error" && toolCallIds.length === 0),
    hasVisibleContent,
    interrupted: stopReason === "aborted",
    key,
    terminalErrorToolCallIds: stopReason === "error" ? toolCallIds : [],
    timestamp,
    toolCallIds,
  };
}

function messageFromEntry(entry: unknown): unknown {
  if (!isRecord(entry) || entry["type"] !== "message") return undefined;
  return entry["message"];
}

function entryTimestamp(entry: unknown): number | undefined {
  if (!isRecord(entry)) return undefined;
  const timestamp = entry["timestamp"];
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp !== "string") return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function invalidateComponent(component: object): void {
  const invalidate: unknown = Reflect.get(component, "invalidate");
  if (typeof invalidate === "function") Reflect.apply(invalidate, component, []);
}

function assistantDisplayClassChanged(
  previous: AssistantSnapshot | undefined,
  current: AssistantSnapshot,
): boolean {
  if (!previous) return false;
  return (
    previous.hasVisibleContent !== current.hasVisibleContent ||
    previous.hasTerminalNotice !== current.hasTerminalNotice
  );
}

export class TurnFoldState {
  private activeAssistantKey: string | undefined;
  private activeAssistantTimestamp: number | undefined;
  private activeGroupId: string | undefined;
  private assistantComponentByKey = new Map<string, object>();
  private assistantGroupByKey = new Map<string, string>();
  private assistantKeyByMessage = new WeakMap<object, string>();
  private assistantOrdinalByTimestamp = new Map<number, number>();
  private componentInfo = new WeakMap<object, { groupId: string; sequence: number }>();
  private compactionComponentGroup = new WeakMap<object, string | null>();
  private compactionGroupByTimestamp = new Map<number, string | null>();
  private groupCounter = 0;
  private groups = new Map<string, TurnGroup>();
  private historyReload: (() => readonly unknown[]) | undefined;
  private latestAssistantKeyByTimestamp = new Map<number, string>();
  private mode: TurnFoldMode = "compact";
  private pendingLiveCompactionGroups: (string | null)[] = [];
  private sequence = 0;
  private toolGroupById = new Map<string, string>();
  private userComponentGroup = new WeakMap<object, string>();
  private userGroupCursor = 0;
  private userGroupIds: string[] = [];

  getMode(): TurnFoldMode {
    return this.mode;
  }

  setMode(mode: TurnFoldMode): void {
    this.mode = mode;
    this.invalidateAllComponents();
  }

  toggleExpanded(): TurnFoldMode {
    this.setMode(nextTurnFoldMode(this.mode));
    return this.mode;
  }

  loadHistory(entries: readonly unknown[]): void {
    this.resetGroups();
    const compactionMetadata = compactionMetadataById(entries);
    let currentGroup: TurnGroup | undefined;
    for (const entry of entries) {
      if (this.indexHistoricalCompactionEntry(currentGroup, entry, compactionMetadata)) continue;

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
        if (currentGroup) {
          this.indexHistoricalMessage(currentGroup, message, entryTimestamp(entry));
        }
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
      this.userGroupIds.push(activeGroup.id);
      return activeGroup.id;
    }

    if (activeGroup) this.settleActive(startedAt);
    const group = this.createGroup(startedAt, false, true);
    this.activeGroupId = group.id;
    return group.id;
  }

  beginAssistantMessage(message: unknown): void {
    const timestamp = numberField(message, "timestamp");
    if (stringField(message, "role") !== "assistant" || timestamp === undefined) return;
    const key = this.newAssistantKey(timestamp);
    this.activeAssistantKey = key;
    this.activeAssistantTimestamp = timestamp;
    this.registerAssistantSnapshot(message, key);
  }

  registerAssistantMessage(message: unknown): void {
    const timestamp = numberField(message, "timestamp");
    if (stringField(message, "role") !== "assistant" || timestamp === undefined) return;
    const key =
      this.messageAssistantKey(message) ??
      (this.activeAssistantTimestamp === timestamp ? this.activeAssistantKey : undefined) ??
      this.latestAssistantKeyByTimestamp.get(timestamp) ??
      this.newAssistantKey(timestamp);
    this.registerAssistantSnapshot(message, key);
  }

  endAssistantMessage(message: unknown): void {
    this.registerAssistantMessage(message);
    if (numberField(message, "timestamp") !== this.activeAssistantTimestamp) return;
    this.activeAssistantKey = undefined;
    this.activeAssistantTimestamp = undefined;
  }

  registerToolStart(toolCallId: string, startedAt = Date.now()): void {
    const groupId = this.ensureActive(startedAt);
    const group = this.groups.get(groupId);
    const added = group ? !group.toolCallIds.has(toolCallId) : false;
    group?.toolCallIds.add(toolCallId);
    this.toolGroupById.set(toolCallId, groupId);
    if (group && added) this.invalidateGroupComponents(group);
  }

  registerToolEnd(toolCallId: string, failed: boolean): void {
    const groupId = this.toolGroupById.get(toolCallId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group || !failed || group.failedToolCallIds.has(toolCallId)) return;
    group.failedToolCallIds.add(toolCallId);
    this.invalidateGroupComponents(group);
  }

  associateUser(component: object): void {
    if (this.userComponentGroup.has(component)) return;
    const groupId = this.userGroupIds[this.userGroupCursor];
    if (!groupId || !this.groups.has(groupId)) return;
    this.userComponentGroup.set(component, groupId);
    this.userGroupCursor += 1;
  }

  userTimestampFor(component: object): number | undefined {
    const groupId = this.userComponentGroup.get(component);
    return groupId ? this.groups.get(groupId)?.startedAt : undefined;
  }

  associateAssistant(component: object, message: unknown): void {
    const timestamp = numberField(message, "timestamp");
    if (timestamp === undefined) return;
    const key =
      this.messageAssistantKey(message) ?? this.latestAssistantKeyByTimestamp.get(timestamp);
    if (!key) return;
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    const group = this.groupForAssistantComponent(component, snapshot);
    if (!group) return;

    const previousSnapshot = group.assistants.get(component);
    const added = this.associateComponent(component, group, "assistant");
    group.assistants.set(component, snapshot);
    if (added || assistantDisplayClassChanged(previousSnapshot, snapshot)) {
      this.invalidateGroupComponents(group);
    }
  }

  associateTool(component: object, toolCallId: string): void {
    const groupId = this.toolGroupById.get(toolCallId) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;

    const added = this.associateComponent(component, group, "tool");
    group.tools.set(component, toolCallId);
    if (added) this.invalidateGroupComponents(group);
  }

  registerCompaction(entry: unknown, reason: CompactionReason): boolean {
    const id = stringField(entry, "id");
    const timestamp = entryTimestamp(entry);
    if (!id || timestamp === undefined) return false;
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : undefined;
    if (reason === "manual" || !group) {
      this.pendingLiveCompactionGroups.push(null);
      return false;
    }
    const added = this.indexCompaction(group, entry);
    if (added) {
      this.pendingLiveCompactionGroups.push(group.id);
      this.invalidateGroupComponents(group);
    }
    return added;
  }

  associateCompaction(component: object, message: unknown): void {
    if (this.compactionComponentGroup.has(component)) return;
    const groupId = this.compactionGroupForTimestamp(numberField(message, "timestamp"));
    this.compactionComponentGroup.set(component, groupId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;
    if (this.associateComponent(component, group, "compaction")) {
      this.invalidateGroupComponents(group);
    }
  }

  settleActive(endedAt = Date.now()): void {
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.settled = true;
      group.endedAt = endedAt;
      this.invalidateGroupComponents(group);
    }
    this.activeGroupId = undefined;
  }

  abortActive(endedAt = Date.now()): void {
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : undefined;
    if (group) group.aborted = true;
    this.settleActive(endedAt);
  }

  viewFor(component: object, now = Date.now()): ComponentView | undefined {
    const groupId = this.componentInfo.get(component)?.groupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return undefined;

    const display = foldDisplay({
      isFinalAnchor: component === this.finalAnchor(group),
      isRecentActivity: this.isRecentActivity(group, component),
      isSettledSummaryAnchor: component === this.settledSummaryAnchor(group),
      isStreamingSummaryAnchor: component === this.streamingSummaryAnchor(group),
      mode: this.mode,
      settled: group.settled,
    });
    return { display, summary: this.summary(group, now) };
  }

  private compactionGroupForTimestamp(timestamp: number | undefined): string | null {
    if (timestamp !== undefined && this.compactionGroupByTimestamp.has(timestamp)) {
      const groupId = this.compactionGroupByTimestamp.get(timestamp) ?? null;
      if (this.pendingLiveCompactionGroups[0] === groupId) {
        this.pendingLiveCompactionGroups.shift();
      }
      return groupId;
    }
    return this.pendingLiveCompactionGroups.shift() ?? null;
  }

  private messageAssistantKey(message: unknown): string | undefined {
    return isRecord(message) ? this.assistantKeyByMessage.get(message) : undefined;
  }

  private newAssistantKey(timestamp: number): string {
    const ordinal = (this.assistantOrdinalByTimestamp.get(timestamp) ?? 0) + 1;
    const key = `${String(timestamp)}:${String(ordinal)}`;
    this.assistantOrdinalByTimestamp.set(timestamp, ordinal);
    this.latestAssistantKeyByTimestamp.set(timestamp, key);
    return key;
  }

  private registerAssistantSnapshot(message: unknown, key: string): void {
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    if (isRecord(message)) this.assistantKeyByMessage.set(message, key);
    this.latestAssistantKeyByTimestamp.set(snapshot.timestamp, key);
    const groupId = this.ensureActive(snapshot.timestamp);
    const group = this.groups.get(groupId);
    if (!group) return;
    const changed = this.indexAssistantSnapshot(group, groupId, snapshot);
    if (changed) this.invalidateGroupComponents(group);
  }

  private groupForAssistantComponent(
    component: object,
    snapshot: AssistantSnapshot,
  ): TurnGroup | undefined {
    const previousComponent = this.assistantComponentByKey.get(snapshot.key);
    if (previousComponent && previousComponent !== component) this.resetComponentAssociations();
    this.assistantComponentByKey.set(snapshot.key, component);
    const groupId = this.assistantGroupByKey.get(snapshot.key) ?? this.activeGroupId;
    return groupId ? this.groups.get(groupId) : undefined;
  }

  private indexAssistantSnapshot(
    group: TurnGroup,
    groupId: string,
    snapshot: AssistantSnapshot,
  ): boolean {
    const previousMessages = group.assistantKeys.size;
    const previousTools = group.toolCallIds.size;
    group.assistantKeys.add(snapshot.key);
    if (snapshot.interrupted) group.aborted = true;
    group.terminalErrorToolCallIds = new Set(snapshot.terminalErrorToolCallIds);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, groupId);
    }
    return (
      group.assistantKeys.size !== previousMessages || group.toolCallIds.size !== previousTools
    );
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

  private streamingSummaryAnchor(group: TurnGroup): object | undefined {
    return this.activityComponents(group).slice(LIVE_ACTIVITY_LIMIT).at(-1)?.[0];
  }

  private settledSummaryAnchor(group: TurnGroup): object | undefined {
    return [...group.components].sort(
      ([, left], [, right]) => left.sequence - right.sequence,
    )[0]?.[0];
  }

  private lastAssistant(group: TurnGroup): object | undefined {
    const candidates = [...group.assistants]
      .filter(([, snapshot]) => snapshot.hasVisibleContent || snapshot.hasTerminalNotice)
      .map(([component]) => component);
    return latestBySequence(group.components, candidates);
  }

  private finalAnchor(group: TurnGroup): object | undefined {
    const terminalErrorToolCallId = [...group.terminalErrorToolCallIds].at(-1);
    if (terminalErrorToolCallId) {
      return this.componentForTool(group, terminalErrorToolCallId);
    }
    const assistant = this.lastAssistant(group);
    if (assistant) return assistant;
    const finalToolCallId = [...group.toolCallIds].at(-1);
    if (!finalToolCallId) return this.activityComponents(group).at(0)?.[0];
    return this.componentForTool(group, finalToolCallId);
  }

  private componentForTool(group: TurnGroup, toolCallId: string | undefined): object | undefined {
    if (!toolCallId) return undefined;
    return [...group.tools].find(([, candidate]) => candidate === toolCallId)?.[0];
  }

  private summary(group: TurnGroup, now: number): FoldSummary {
    const activityCount = this.activityComponents(group).length;
    return {
      aborted: group.aborted,
      compactions: group.compactionIds.size,
      completedAt: group.endedAt,
      durationMs: Math.max(0, (group.endedAt ?? now) - group.startedAt),
      failedTools: new Set([...group.failedToolCallIds, ...group.terminalErrorToolCallIds]).size,
      hiddenActivities: Math.max(0, activityCount - LIVE_ACTIVITY_LIMIT),
      messages: group.assistantKeys.size,
      running: !group.settled,
      tools: group.toolCallIds.size,
    };
  }

  private associateComponent(component: object, group: TurnGroup, kind: ComponentKind): boolean {
    if (this.componentInfo.has(component)) return false;
    this.sequence += 1;
    const info = { kind, sequence: this.sequence };
    group.components.set(component, info);
    this.componentInfo.set(component, { groupId: group.id, sequence: info.sequence });
    return true;
  }

  private createGroup(startedAt: number, settled: boolean, startedByUser = false): TurnGroup {
    this.groupCounter += 1;
    const group: TurnGroup = {
      aborted: false,
      assistantKeys: new Set(),
      assistants: new Map(),
      compactionIds: new Set(),
      compactionTimestamps: new Set(),
      components: new Map(),
      failedToolCallIds: new Set(),
      id: `turn-${String(this.groupCounter)}`,
      settled,
      startedAt,
      startedByUser,
      terminalErrorToolCallIds: new Set(),
      toolCallIds: new Set(),
      tools: new Map(),
    };
    this.groups.set(group.id, group);
    if (startedByUser) this.userGroupIds.push(group.id);
    return group;
  }

  private indexHistoricalCompactionEntry(
    currentGroup: TurnGroup | undefined,
    entry: unknown,
    metadata: ReadonlyMap<string, CompactionMetadata>,
  ): boolean {
    if (stringField(entry, "type") !== "compaction") return false;
    const id = stringField(entry, "id");
    const timestamp = entryTimestamp(entry);
    if (currentGroup && id && metadata.get(id)?.attachedToTurn === true) {
      this.indexCompaction(currentGroup, entry);
    } else if (timestamp !== undefined) {
      this.compactionGroupByTimestamp.set(timestamp, null);
    }
    return true;
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

  private indexHistoricalMessage(
    group: TurnGroup,
    message: unknown,
    completedAt: number | undefined,
  ): void {
    const role = stringField(message, "role");
    if (role === "assistant") this.indexHistoricalAssistant(group, message, completedAt);
    if (role === "toolResult") this.indexHistoricalToolResult(group, message, completedAt);
  }

  private indexCompaction(group: TurnGroup, entry: unknown): boolean {
    const id = stringField(entry, "id");
    const timestamp = entryTimestamp(entry);
    if (!id || timestamp === undefined || group.compactionIds.has(id)) return false;
    group.compactionIds.add(id);
    group.compactionTimestamps.add(timestamp);
    this.compactionGroupByTimestamp.set(timestamp, group.id);
    return true;
  }

  private indexHistoricalAssistant(
    group: TurnGroup,
    message: unknown,
    completedAt: number | undefined,
  ): void {
    const timestamp = numberField(message, "timestamp");
    if (timestamp === undefined) return;
    const key = this.newAssistantKey(timestamp);
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    if (isRecord(message)) this.assistantKeyByMessage.set(message, key);
    group.assistantKeys.add(snapshot.key);
    if (snapshot.interrupted) group.aborted = true;
    group.terminalErrorToolCallIds = new Set(snapshot.terminalErrorToolCallIds);
    this.assistantGroupByKey.set(snapshot.key, group.id);
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    group.endedAt = Math.max(group.endedAt ?? 0, completedAt ?? snapshot.timestamp);
  }

  private indexHistoricalToolResult(
    group: TurnGroup,
    message: unknown,
    completedAt: number | undefined,
  ): void {
    const toolCallId = stringField(message, "toolCallId");
    if (toolCallId) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    if (toolCallId && isRecord(message) && message["isError"] === true) {
      group.failedToolCallIds.add(toolCallId);
    }
    const timestamp = completedAt ?? numberField(message, "timestamp");
    if (timestamp !== undefined) group.endedAt = Math.max(group.endedAt ?? 0, timestamp);
  }

  private invalidateGroupComponents(group: TurnGroup): void {
    for (const component of group.components.keys()) invalidateComponent(component);
  }

  private invalidateAllComponents(): void {
    for (const group of this.groups.values()) this.invalidateGroupComponents(group);
  }

  private resetComponentAssociations(): void {
    this.assistantComponentByKey = new Map();
    this.compactionComponentGroup = new WeakMap();
    this.componentInfo = new WeakMap();
    this.sequence = 0;
    this.userComponentGroup = new WeakMap();
    this.userGroupCursor = 0;
    for (const group of this.groups.values()) {
      group.assistants.clear();
      group.components.clear();
      group.tools.clear();
    }
  }

  private resetGroups(): void {
    this.activeAssistantKey = undefined;
    this.activeAssistantTimestamp = undefined;
    this.activeGroupId = undefined;
    this.assistantComponentByKey = new Map();
    this.assistantGroupByKey = new Map();
    this.assistantKeyByMessage = new WeakMap();
    this.assistantOrdinalByTimestamp = new Map();
    this.componentInfo = new WeakMap();
    this.compactionComponentGroup = new WeakMap();
    this.compactionGroupByTimestamp = new Map();
    this.groups = new Map();
    this.groupCounter = 0;
    this.historyReload = undefined;
    this.latestAssistantKeyByTimestamp = new Map();
    this.pendingLiveCompactionGroups = [];
    this.sequence = 0;
    this.toolGroupById = new Map();
    this.userComponentGroup = new WeakMap();
    this.userGroupCursor = 0;
    this.userGroupIds = [];
  }

  private reloadHistory(entries: readonly unknown[]): void {
    const activeGroupId = this.activeGroupId;
    const activeGroup = activeGroupId ? this.groups.get(activeGroupId) : undefined;
    const pendingLiveCompactionGroups = [...this.pendingLiveCompactionGroups];
    this.loadHistory(entries);
    this.pendingLiveCompactionGroups = pendingLiveCompactionGroups;
    if (!activeGroupId || !activeGroup) return;

    const visibleGroups = [...this.groups.values()];
    const activeGroups = this.reloadedActiveGroups(visibleGroups, activeGroup);
    this.mergeVisibleActiveGroups(activeGroup, activeGroups);
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    for (const group of activeGroups) this.groups.delete(group.id);
    this.groups.set(activeGroup.id, activeGroup);
    this.reassignGroupIds(activeGroupIds, activeGroup.id);
    this.rebuildCompactionGroupIndex();
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
      active.aborted ||= visible.aborted;
      active.assistantKeys = new Set([...active.assistantKeys, ...visible.assistantKeys]);
      active.compactionIds = new Set([...active.compactionIds, ...visible.compactionIds]);
      active.compactionTimestamps = new Set([
        ...active.compactionTimestamps,
        ...visible.compactionTimestamps,
      ]);
      active.failedToolCallIds = new Set([
        ...active.failedToolCallIds,
        ...visible.failedToolCallIds,
      ]);
      active.terminalErrorToolCallIds = new Set(visible.terminalErrorToolCallIds);
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
    this.userGroupIds = this.userGroupIds.map((groupId) =>
      fromGroupIds.has(groupId) ? toGroupId : groupId,
    );
  }

  private rebuildCompactionGroupIndex(): void {
    for (const group of this.groups.values()) {
      for (const timestamp of group.compactionTimestamps) {
        this.compactionGroupByTimestamp.set(timestamp, group.id);
      }
    }
  }
}
