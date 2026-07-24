import { editDiffFromToolResult, type EditDiffSummary, TurnEditDiffs } from "./edit-diff-stat.ts";
import type { CompactionReason, EphemeralCompactionAssociation } from "./ephemeral-compactions.ts";
import { foldDisplay, type FoldDisplay } from "./fold-policy.ts";
import { nextTurnFoldMode, type TurnFoldMode } from "./mode.ts";
import {
  assistantSnapshot,
  type AssistantSnapshot,
  entryTimestamp,
  isRecord,
  messageFromEntry,
  numberField,
  stringField,
} from "./turn-message.ts";

const LIVE_ACTIVITY_LIMIT = 3;

type ComponentKind = "assistant" | "compaction" | "tool";

type ComponentInfo = {
  kind: ComponentKind;
  sequence: number;
};

type GroupLayoutParts = {
  activities: object[];
  lastAssistant: object | undefined;
  toolComponents: Map<string, object>;
};

type GroupLayout = {
  failedTools: number;
  finalAnchor: object | undefined;
  hiddenActivities: number;
  recentActivities: ReadonlySet<object>;
  revision: number;
  settledSummaryAnchor: object | undefined;
  streamingSummaryAnchor: object | undefined;
};

type TurnGroup = {
  aborted: boolean;
  assistantKeys: Set<string>;
  assistants: Map<object, AssistantSnapshot>;
  compactionIds: Set<string>;
  compactionTimestamps: Set<number>;
  components: Map<object, ComponentInfo>;
  editDiffs: TurnEditDiffs;
  endedAt?: number;
  failedToolCallIds: Set<string>;
  id: string;
  layout: GroupLayout | undefined;
  revision: number;
  settled: boolean;
  startedAt: number;
  startedByUser: boolean;
  terminalErrorToolCallIds: Set<string>;
  toolCallIds: Set<string>;
  tools: Map<object, string>;
};

export type FoldFileDiff = EditDiffSummary;

export type FoldSummary = {
  aborted: boolean;
  compactions: number;
  completedAt: number | undefined;
  durationMs: number;
  failedTools: number;
  fileDiff?: FoldFileDiff;
  hiddenActivities: number;
  messages: number;
  running: boolean;
  tools: number;
};

export type ComponentView = {
  display: FoldDisplay;
  summary: FoldSummary;
};

function groupNumber(id: string): number {
  const value = Number(id.slice("turn-".length));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function invalidateComponent(component: object): void {
  const invalidate: unknown = Reflect.get(component, "invalidate");
  if (typeof invalidate === "function") Reflect.apply(invalidate, component, []);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assistantHasVisibleContent(snapshot: AssistantSnapshot | undefined): boolean {
  return snapshot?.hasVisibleContent === true;
}

function assistantIsDisplayable(snapshot: AssistantSnapshot | undefined): boolean {
  return snapshot?.hasVisibleContent === true || snapshot?.hasTerminalNotice === true;
}

function assistantLayoutChanged(
  previous: AssistantSnapshot | undefined,
  current: AssistantSnapshot,
): boolean {
  if (!previous) return false;
  return (
    previous.hasVisibleContent !== current.hasVisibleContent ||
    previous.hasTerminalNotice !== current.hasTerminalNotice ||
    previous.interrupted !== current.interrupted ||
    !sameStrings(previous.terminalErrorToolCallIds, current.terminalErrorToolCallIds)
  );
}

export class TurnFoldState {
  private compactionAssociations = new Map<string, EphemeralCompactionAssociation>();
  private activeAssistantKey: string | undefined;
  private activeAssistantTimestamp: number | undefined;
  private activeGroupId: string | undefined;
  private assistantComponentByKey = new Map<string, object>();
  private assistantGroupByKey = new Map<string, string>();
  private assistantKeyByMessage = new WeakMap<object, string>();
  private assistantOrdinalByTimestamp = new Map<number, number>();
  private assistantSnapshotByMessage = new WeakMap<object, AssistantSnapshot>();
  private componentInfo = new WeakMap<object, { groupId: string; sequence: number }>();
  private compactionComponentGroup = new WeakMap<object, string | null>();
  private compactionGroupByTimestamp = new Map<number, string | null>();
  private groupCounter = 0;
  private groups = new Map<string, TurnGroup>();
  private historicalGroupByEntryId = new Map<string, string>();
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

  loadHistory(
    entries: readonly unknown[],
    compactionAssociations: ReadonlyMap<string, EphemeralCompactionAssociation> = new Map(),
  ): void {
    this.resetGroups();
    this.compactionAssociations = new Map(compactionAssociations);
    let currentGroup: TurnGroup | undefined;
    for (const entry of entries) {
      if (this.indexHistoricalCompactionEntry(entry)) continue;

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
      this.rememberHistoricalEntryGroup(entry, currentGroup);
    }
    this.restoreCompactionAssociations();
  }

  replaceCompactionAssociations(
    compactionAssociations: ReadonlyMap<string, EphemeralCompactionAssociation>,
  ): void {
    this.compactionAssociations = new Map(compactionAssociations);
    this.pendingLiveCompactionGroups = [];
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
    if (group && added) this.markGroupChanged(group);
  }

  registerToolEnd(toolCallId: string, failed: boolean): void {
    const groupId = this.toolGroupById.get(toolCallId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group || !failed || group.failedToolCallIds.has(toolCallId)) return;
    group.failedToolCallIds.add(toolCallId);
    this.markGroupChanged(group);
  }

  registerToolResult(message: unknown): void {
    const editDiff = editDiffFromToolResult(message);
    if (!editDiff) return;
    const groupId = this.toolGroupById.get(editDiff.toolCallId) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (group?.editDiffs.add(editDiff.toolCallId, editDiff.stat)) {
      this.markGroupChanged(group);
    }
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
    const snapshot = this.cachedAssistantSnapshot(message, key);
    if (!snapshot) return;
    const group = this.groupForAssistantComponent(component, snapshot);
    if (!group) return;

    const previousSnapshot = group.assistants.get(component);
    const added = this.associateComponent(component, group, "assistant");
    group.assistants.set(component, snapshot);
    if (added || assistantLayoutChanged(previousSnapshot, snapshot)) {
      this.markGroupChanged(group);
    }
  }

  associateTool(component: object, toolCallId: string): void {
    const groupId = this.toolGroupById.get(toolCallId) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;

    const added = this.associateComponent(component, group, "tool");
    group.tools.set(component, toolCallId);
    if (added) this.markGroupChanged(group);
  }

  registerCompaction(
    entry: unknown,
    reason: CompactionReason,
    turnEntryIds: readonly string[] = [],
  ): EphemeralCompactionAssociation | undefined {
    const compactionEntryId = stringField(entry, "id");
    const timestamp = entryTimestamp(entry);
    if (!compactionEntryId || timestamp === undefined) return undefined;
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : undefined;
    if (reason === "manual" || !group) {
      this.queueLiveCompactionComponents(null);
      return undefined;
    }
    const association = {
      compactionEntryId,
      timestamp,
      turnEntryIds: [...turnEntryIds],
      turnStartedAt: group.startedAt,
    };
    this.compactionAssociations.set(compactionEntryId, association);
    const added = this.indexCompactionAssociation(group, association);
    this.queueLiveCompactionComponents(group.id);
    if (added) this.markGroupChanged(group);
    return association;
  }

  associateCompaction(component: object, message: unknown): void {
    if (this.compactionComponentGroup.has(component)) return;
    const groupId = this.compactionGroupForTimestamp(numberField(message, "timestamp"));
    this.compactionComponentGroup.set(component, groupId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return;
    if (this.associateComponent(component, group, "compaction")) {
      this.markGroupChanged(group);
    }
  }

  settleActive(endedAt = Date.now()): void {
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.settled = true;
      group.endedAt = endedAt;
      this.markGroupChanged(group);
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

    const layout = this.layoutFor(group);
    const display = foldDisplay({
      isFinalAnchor: component === layout.finalAnchor,
      isRecentActivity: layout.recentActivities.has(component),
      isSettledSummaryAnchor: component === layout.settledSummaryAnchor,
      isStreamingSummaryAnchor: component === layout.streamingSummaryAnchor,
      mode: this.mode,
      settled: group.settled,
    });
    return { display, summary: this.summary(group, layout, now) };
  }

  private queueLiveCompactionComponents(groupId: string | null): void {
    // Pi rebuilds the stored compaction row, then appends a second live row.
    this.pendingLiveCompactionGroups.push(groupId, groupId);
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

  private cachedAssistantSnapshot(message: unknown, key: string): AssistantSnapshot | undefined {
    if (isRecord(message)) {
      const cached = this.assistantSnapshotByMessage.get(message);
      if (cached?.key === key) return cached;
    }
    return this.captureAssistantSnapshot(message, key);
  }

  private captureAssistantSnapshot(message: unknown, key: string): AssistantSnapshot | undefined {
    const snapshot = assistantSnapshot(message, key);
    if (snapshot && isRecord(message)) this.assistantSnapshotByMessage.set(message, snapshot);
    return snapshot;
  }

  private registerAssistantSnapshot(message: unknown, key: string): void {
    const snapshot = this.captureAssistantSnapshot(message, key);
    if (!snapshot) return;
    if (isRecord(message)) this.assistantKeyByMessage.set(message, key);
    this.latestAssistantKeyByTimestamp.set(snapshot.timestamp, key);
    const groupId = this.ensureActive(snapshot.timestamp);
    const group = this.groups.get(groupId);
    if (!group) return;
    const changed = this.indexAssistantSnapshot(group, groupId, snapshot);
    if (changed) this.markGroupChanged(group);
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
    const wasAborted = group.aborted;
    const previousTerminalErrors = [...group.terminalErrorToolCallIds];
    group.assistantKeys.add(snapshot.key);
    if (snapshot.interrupted) group.aborted = true;
    group.terminalErrorToolCallIds = new Set(snapshot.terminalErrorToolCallIds);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, groupId);
    }
    return (
      group.assistantKeys.size !== previousMessages ||
      group.toolCallIds.size !== previousTools ||
      group.aborted !== wasAborted ||
      !sameStrings(previousTerminalErrors, snapshot.terminalErrorToolCallIds)
    );
  }

  private groupHasActivity(group: TurnGroup): boolean {
    return group.assistantKeys.size > 0 || group.toolCallIds.size > 0;
  }

  private collectLayoutComponent(
    group: TurnGroup,
    parts: GroupLayoutParts,
    component: object,
    info: ComponentInfo,
  ): void {
    const assistant = group.assistants.get(component);
    if (info.kind === "tool" || assistantHasVisibleContent(assistant)) {
      parts.activities.push(component);
    }
    if (assistantIsDisplayable(assistant)) parts.lastAssistant = component;
    const toolCallId = group.tools.get(component);
    if (toolCallId) parts.toolComponents.set(toolCallId, component);
  }

  private collectLayoutParts(group: TurnGroup): GroupLayoutParts {
    const parts: GroupLayoutParts = {
      activities: [],
      lastAssistant: undefined,
      toolComponents: new Map(),
    };
    for (const [component, info] of group.components) {
      this.collectLayoutComponent(group, parts, component, info);
    }
    return parts;
  }

  private lastToolCallId(toolCallIds: ReadonlySet<string>): string | undefined {
    let last: string | undefined;
    for (const toolCallId of toolCallIds) last = toolCallId;
    return last;
  }

  private finalAnchor(group: TurnGroup, parts: GroupLayoutParts): object | undefined {
    const terminalError = this.lastToolCallId(group.terminalErrorToolCallIds);
    if (terminalError) return parts.toolComponents.get(terminalError);
    if (parts.lastAssistant) return parts.lastAssistant;
    const finalTool = this.lastToolCallId(group.toolCallIds);
    return finalTool ? parts.toolComponents.get(finalTool) : parts.activities.at(-1);
  }

  private layoutFor(group: TurnGroup): GroupLayout {
    if (group.layout?.revision === group.revision) return group.layout;
    const parts = this.collectLayoutParts(group);
    const layout: GroupLayout = {
      failedTools: new Set([...group.failedToolCallIds, ...group.terminalErrorToolCallIds]).size,
      finalAnchor: this.finalAnchor(group, parts),
      hiddenActivities: Math.max(0, parts.activities.length - LIVE_ACTIVITY_LIMIT),
      recentActivities: new Set(parts.activities.slice(-LIVE_ACTIVITY_LIMIT)),
      revision: group.revision,
      settledSummaryAnchor: group.components.keys().next().value,
      streamingSummaryAnchor:
        parts.activities.length > LIVE_ACTIVITY_LIMIT ? parts.activities[0] : undefined,
    };
    group.layout = layout;
    return layout;
  }

  private summary(group: TurnGroup, layout: GroupLayout, now: number): FoldSummary {
    const summary: FoldSummary = {
      aborted: group.aborted,
      compactions: group.compactionIds.size,
      completedAt: group.endedAt,
      durationMs: Math.max(0, (group.endedAt ?? now) - group.startedAt),
      failedTools: layout.failedTools,
      hiddenActivities: layout.hiddenActivities,
      messages: group.assistantKeys.size,
      running: !group.settled,
      tools: group.toolCallIds.size,
    };
    const fileDiff = group.editDiffs.summary();
    if (fileDiff) summary.fileDiff = fileDiff;
    return summary;
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
      editDiffs: new TurnEditDiffs(),
      failedToolCallIds: new Set(),
      id: `turn-${String(this.groupCounter)}`,
      layout: undefined,
      revision: 0,
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

  private indexHistoricalCompactionEntry(entry: unknown): boolean {
    if (stringField(entry, "type") !== "compaction") return false;
    const timestamp = entryTimestamp(entry);
    if (timestamp !== undefined) this.compactionGroupByTimestamp.set(timestamp, null);
    return true;
  }

  private restoreCompactionAssociations(): void {
    for (const association of this.compactionAssociations.values()) {
      const groupFromEntry = association.turnEntryIds
        .map((entryId) => this.historicalGroupByEntryId.get(entryId))
        .find((groupId) => groupId !== undefined);
      const group = groupFromEntry
        ? this.groups.get(groupFromEntry)
        : [...this.groups.values()].find(
            (candidate) => candidate.startedAt === association.turnStartedAt,
          );
      if (group) this.indexCompactionAssociation(group, association);
    }
  }

  private rememberHistoricalEntryGroup(entry: unknown, group: TurnGroup | undefined): void {
    const entryId = stringField(entry, "id");
    if (group && entryId) this.historicalGroupByEntryId.set(entryId, group.id);
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

  private indexCompactionAssociation(
    group: TurnGroup,
    association: EphemeralCompactionAssociation,
  ): boolean {
    if (group.compactionIds.has(association.compactionEntryId)) return false;
    group.compactionIds.add(association.compactionEntryId);
    group.compactionTimestamps.add(association.timestamp);
    this.compactionGroupByTimestamp.set(association.timestamp, group.id);
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
    const snapshot = this.captureAssistantSnapshot(message, key);
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
    this.indexHistoricalToolError(group, message, toolCallId);
    const editDiff = editDiffFromToolResult(message);
    if (editDiff) group.editDiffs.add(editDiff.toolCallId, editDiff.stat);
    const timestamp = completedAt ?? numberField(message, "timestamp");
    if (timestamp !== undefined) group.endedAt = Math.max(group.endedAt ?? 0, timestamp);
  }

  private indexHistoricalToolError(
    group: TurnGroup,
    message: unknown,
    toolCallId: string | undefined,
  ): void {
    if (toolCallId && isRecord(message) && message["isError"] === true) {
      group.failedToolCallIds.add(toolCallId);
    }
  }

  private invalidateGroupComponents(group: TurnGroup): void {
    for (const component of group.components.keys()) invalidateComponent(component);
  }

  private markGroupChanged(group: TurnGroup): void {
    group.revision += 1;
    group.layout = undefined;
    this.invalidateGroupComponents(group);
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
      group.revision += 1;
      group.layout = undefined;
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
    this.assistantSnapshotByMessage = new WeakMap();
    this.componentInfo = new WeakMap();
    this.compactionComponentGroup = new WeakMap();
    this.compactionGroupByTimestamp = new Map();
    this.groups = new Map();
    this.groupCounter = 0;
    this.historicalGroupByEntryId = new Map();
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
    const compactionAssociations = new Map(this.compactionAssociations);
    this.loadHistory(entries, compactionAssociations);
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
      active.editDiffs.merge(visible.editDiffs);
    }
    active.revision += 1;
    active.layout = undefined;
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
