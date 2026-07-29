export type UsageSnapshot =
  | {
      cacheRead?: number;
      cacheWrite?: number;
      input?: number;
      output?: number;
      totalTokens?: number;
    }
  | null
  | undefined;

function optionalNumberField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function numberField(value: unknown, key: string): number {
  return optionalNumberField(value, key) ?? 0;
}

export function tokenDeltaFromUsage(usage: unknown): number {
  const totalTokens = optionalNumberField(usage, "totalTokens");
  if (totalTokens !== undefined) return Math.max(0, totalTokens);
  const input = numberField(usage, "input");
  const output = numberField(usage, "output");
  const cacheRead = numberField(usage, "cacheRead");
  const cacheWrite = numberField(usage, "cacheWrite");
  return Math.max(0, input + output + cacheRead + cacheWrite);
}
