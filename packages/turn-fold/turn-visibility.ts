import { stringField } from "./turn-message.ts";

export function projectedGroupIds(
  displayEntries: readonly unknown[],
  historicalGroupByEntryId: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const groupIds = new Set<string>();
  for (const entry of displayEntries) {
    if (stringField(entry, "type") === "custom") continue;
    const entryId = stringField(entry, "id");
    const groupId = entryId ? historicalGroupByEntryId.get(entryId) : undefined;
    if (groupId) groupIds.add(groupId);
  }
  return groupIds;
}
