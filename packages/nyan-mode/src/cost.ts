export function cumulativeApiCost(entries: readonly unknown[]): number {
  let total = 0;
  for (const entry of entries) total += entryApiCost(entry);
  return total;
}

export function formatApiCost(total: number, usingSubscription: boolean): string | undefined {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  if (safeTotal === 0 && !usingSubscription) return undefined;
  return `$${safeTotal.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
}

function entryApiCost(entry: unknown): number {
  const message = messageRecord(entry);
  if (message?.["role"] !== "assistant") return 0;
  const usage = recordValue(message, "usage");
  const cost = recordValue(usage, "cost");
  return positiveFiniteNumber(cost?.["total"]);
}

function messageRecord(entry: unknown): Record<string, unknown> | undefined {
  if (!isRecord(entry) || entry["type"] !== "message") return undefined;
  return recordValue(entry, "message");
}

function recordValue(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function positiveFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
