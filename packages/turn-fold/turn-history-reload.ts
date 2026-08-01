import type { TurnEditDiffs } from "./edit-diff-stat.ts";

export type ReloadableTurnGroup = {
  aborted: boolean;
  assistantKeys: Set<string>;
  assistants: Map<object, unknown>;
  compactionIds: Set<string>;
  compactionTimestamps: Set<number>;
  components: Map<object, unknown>;
  editDiffs: TurnEditDiffs;
  endedAt?: number;
  failedToolCallIds: Set<string>;
  id: string;
  layout: unknown;
  revision: number;
  startedAt: number;
  terminalErrorToolCallIds: Set<string>;
  toolCallIds: Set<string>;
  tools: Map<object, string>;
  visibleAssistantKeys: Set<string>;
};

export function reloadedActiveGroups<T extends ReloadableTurnGroup>(
  visibleGroups: readonly T[],
  activeGroup: T,
): readonly T[] {
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

export function mergeVisibleActiveGroups<T extends ReloadableTurnGroup>(
  active: T,
  visibleGroups: readonly T[],
): void {
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
    active.failedToolCallIds = new Set([...active.failedToolCallIds, ...visible.failedToolCallIds]);
    active.terminalErrorToolCallIds = new Set(visible.terminalErrorToolCallIds);
    active.toolCallIds = new Set([...active.toolCallIds, ...visible.toolCallIds]);
    active.visibleAssistantKeys = new Set([
      ...active.visibleAssistantKeys,
      ...visible.visibleAssistantKeys,
    ]);
    active.editDiffs.merge(visible.editDiffs);
  }
  active.revision += 1;
  active.layout = undefined;
}

export function reassignGroupIds(
  assistantGroupByKey: Map<string, string>,
  toolGroupById: Map<string, string>,
  userGroupIds: readonly string[],
  fromGroupIds: ReadonlySet<string>,
  toGroupId: string,
): string[] {
  for (const [key, groupId] of assistantGroupByKey) {
    if (fromGroupIds.has(groupId)) assistantGroupByKey.set(key, toGroupId);
  }
  for (const [key, groupId] of toolGroupById) {
    if (fromGroupIds.has(groupId)) toolGroupById.set(key, toGroupId);
  }
  return userGroupIds.map((groupId) => (fromGroupIds.has(groupId) ? toGroupId : groupId));
}

export function compactionGroupIndex<T extends ReloadableTurnGroup>(
  index: Map<number, string | null>,
  groups: Iterable<T>,
): void {
  for (const group of groups) {
    for (const timestamp of group.compactionTimestamps) index.set(timestamp, group.id);
  }
}
