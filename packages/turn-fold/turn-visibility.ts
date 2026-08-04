import { messageFromEntry, stringField } from "./turn-message.ts";

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
    const entryId = stringField(entry, "id");
    const groupId = entryId ? historicalGroupByEntryId.get(entryId) : undefined;
    if (groupId) groupIds.add(groupId);
  }
  return groupIds;
}
