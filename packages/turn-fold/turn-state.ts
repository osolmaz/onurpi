import { foldDisplay, type FoldDisplay } from "./fold-policy.ts";
import type { TurnFoldMode } from "./mode.ts";

type ComponentKind = "assistant" | "tool";

type AssistantSnapshot = {
  hasText: boolean;
  hasToolCalls: boolean;
  key: string;
  timestamp: number;
  toolCallIds: string[];
};

type ComponentInfo = {
  kind: ComponentKind;
  sequence: number;
};

type TurnGroup = {
  assistants: Map<object, AssistantSnapshot>;
  components: Map<object, ComponentInfo>;
  endedAt?: number;
  failedToolCallIds: Set<string>;
  id: string;
  settled: boolean;
  startedAt: number;
  tools: Map<object, string>;
};

export type FoldSummary = {
  durationMs: number;
  failedTools: number;
  intermediateMessages: number;
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

function summarizeAssistantContent(items: readonly unknown[]): {
  hasText: boolean;
  toolCallIds: string[];
} {
  let hasText = false;
  const toolCallIds: string[] = [];
  for (const item of items) {
    const type = stringField(item, "type");
    const text = type === "text" ? stringField(item, "text") : undefined;
    if (text?.trim()) hasText = true;
    const toolCallId = type === "toolCall" ? stringField(item, "id") : undefined;
    if (toolCallId) toolCallIds.push(toolCallId);
  }
  return { hasText, toolCallIds };
}

function assistantSnapshot(message: unknown): AssistantSnapshot | undefined {
  if (stringField(message, "role") !== "assistant") return undefined;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === undefined) return undefined;

  const { hasText, toolCallIds } = summarizeAssistantContent(contentItems(message));
  const responseId = stringField(message, "responseId") ?? "";
  return {
    hasText,
    hasToolCalls: toolCallIds.length > 0,
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

export class TurnFoldState {
  private activeGroupId: string | undefined;
  private assistantGroupByKey = new Map<string, string>();
  private componentInfo = new WeakMap<object, { groupId: string }>();
  private groupCounter = 0;
  private groups = new Map<string, TurnGroup>();
  private mode: TurnFoldMode = "live";
  private previousCompactMode: Exclude<TurnFoldMode, "expanded"> = "live";
  private sequence = 0;
  private toolGroupById = new Map<string, string>();

  getMode(): TurnFoldMode {
    return this.mode;
  }

  setMode(mode: TurnFoldMode): void {
    this.mode = mode;
    if (mode !== "expanded") this.previousCompactMode = mode;
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
      if (stringField(message, "role") === "user") {
        currentGroup = this.createGroup(numberField(message, "timestamp") ?? Date.now(), true);
        continue;
      }
      if (currentGroup) this.indexHistoricalMessage(currentGroup, message);
    }
  }

  ensureActive(startedAt = Date.now()): string {
    if (this.activeGroupId) return this.activeGroupId;
    const group = this.createGroup(startedAt, false);
    this.activeGroupId = group.id;
    return group.id;
  }

  registerAssistantMessage(message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
    const groupId = this.ensureActive(snapshot.timestamp);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      this.toolGroupById.set(toolCallId, groupId);
    }
  }

  registerToolStart(toolCallId: string, startedAt = Date.now()): void {
    this.toolGroupById.set(toolCallId, this.ensureActive(startedAt));
  }

  registerToolEnd(toolCallId: string, failed: boolean): void {
    const groupId = this.toolGroupById.get(toolCallId);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (group && failed) group.failedToolCallIds.add(toolCallId);
  }

  associateAssistant(component: object, message: unknown): void {
    const snapshot = assistantSnapshot(message);
    if (!snapshot) return;
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
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.settled = true;
      group.endedAt = endedAt;
    }
    this.activeGroupId = undefined;
  }

  viewFor(component: object, now = Date.now()): ComponentView | undefined {
    const groupId = this.componentInfo.get(component)?.groupId;
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) return undefined;

    const finalAssistant = this.finalAssistant(group);
    const anchor = this.foldAnchor(group, finalAssistant);
    const display = foldDisplay({
      isAnchor: component === anchor,
      isFinalAssistant: component === finalAssistant,
      mode: this.mode,
      settled: group.settled,
    });

    return {
      display,
      summary: this.summary(group, finalAssistant, now),
    };
  }

  private resetGroups(): void {
    this.activeGroupId = undefined;
    this.assistantGroupByKey = new Map();
    this.componentInfo = new WeakMap();
    this.groups = new Map();
    this.groupCounter = 0;
    this.sequence = 0;
    this.toolGroupById = new Map();
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
    for (const toolCallId of snapshot.toolCallIds) {
      this.toolGroupById.set(toolCallId, group.id);
    }
    group.endedAt = Math.max(group.endedAt ?? 0, snapshot.timestamp);
  }

  private indexHistoricalToolResult(group: TurnGroup, message: unknown): void {
    const toolCallId = stringField(message, "toolCallId");
    if (toolCallId) this.toolGroupById.set(toolCallId, group.id);
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
    group.components.set(component, { kind, sequence: this.sequence });
    this.componentInfo.set(component, { groupId: group.id });
  }

  private createGroup(startedAt: number, settled: boolean): TurnGroup {
    this.groupCounter += 1;
    const group: TurnGroup = {
      assistants: new Map(),
      components: new Map(),
      failedToolCallIds: new Set(),
      id: `turn-${String(this.groupCounter)}`,
      settled,
      startedAt,
      tools: new Map(),
    };
    this.groups.set(group.id, group);
    return group;
  }

  private finalAssistant(group: TurnGroup): object | undefined {
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

  private foldAnchor(group: TurnGroup, finalAssistant: object | undefined): object | undefined {
    return [...group.components]
      .filter(([component]) => component !== finalAssistant)
      .sort(([, left], [, right]) => left.sequence - right.sequence)
      .at(0)?.[0];
  }

  private summary(group: TurnGroup, finalAssistant: object | undefined, now: number): FoldSummary {
    const intermediateMessages = [...group.assistants].filter(
      ([component, snapshot]) => component !== finalAssistant && snapshot.hasText,
    ).length;
    return {
      durationMs: Math.max(0, (group.endedAt ?? now) - group.startedAt),
      failedTools: group.failedToolCallIds.size,
      intermediateMessages,
      running: !group.settled,
      tools: group.tools.size,
    };
  }
}
