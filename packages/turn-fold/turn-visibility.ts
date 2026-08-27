import { messageFromEntry, stringField } from "./turn-message.ts";

function historicalGroupId(
  entry: unknown,
  historicalGroupByEntryId: ReadonlyMap<string, string>,
): string | undefined {
  const entryId = stringField(entry, "id");
  return entryId ? historicalGroupByEntryId.get(entryId) : undefined;
}

export function projectedGroupIds(
  displayEntries: readonly unknown[],
  historicalGroupByEntryId: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const groupIds = new Set<string>();
  for (const entry of displayEntries) {
    const type = stringField(entry, "type");
    const role = stringField(messageFromEntry(entry), "role");
    const isRunContent =
      type === "custom_message" || role === "user" || role === "assistant" || role === "toolResult";
    if (!isRunContent) continue;
    const groupId = historicalGroupId(entry, historicalGroupByEntryId);
    if (groupId) groupIds.add(groupId);
  }
  return groupIds;
}

export function projectedUserGroupIds(
  displayEntries: readonly unknown[],
  historicalGroupByEntryId: ReadonlyMap<string, string>,
): readonly string[] {
  const groupIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of displayEntries) {
    if (stringField(messageFromEntry(entry), "role") !== "user") continue;
    const groupId = historicalGroupId(entry, historicalGroupByEntryId);
    if (!groupId || seen.has(groupId)) continue;
    seen.add(groupId);
    groupIds.push(groupId);
  }
  return groupIds;
}

type UserStartedGroup = { id: string; startedByUser: boolean };

export function projectedUserQueueGroupIds(
  displayEntries: readonly unknown[],
  historicalGroupByEntryId: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, UserStartedGroup>,
  activeGroupId: string | undefined,
): string[] {
  const ids = projectedUserGroupIds(displayEntries, historicalGroupByEntryId).filter((groupId) =>
    groups.has(groupId),
  );
  const active = activeGroupId ? groups.get(activeGroupId) : undefined;
  if (active?.startedByUser && !ids.includes(active.id)) ids.push(active.id);
  return ids;
}
