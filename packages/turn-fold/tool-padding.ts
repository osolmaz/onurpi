const TOOL_PADDING_TARGET_KEYS = ["contentBox", "contentText"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function removeHorizontalPadding(target: unknown): boolean {
  if (!isRecord(target) || typeof target["paddingX"] !== "number") return false;
  if (target["paddingX"] === 0 || typeof target["invalidate"] !== "function") return false;
  if (!Reflect.set(target, "paddingX", 0)) return false;
  Reflect.apply(target["invalidate"], target, []);
  return true;
}

export function removeToolHorizontalPadding(component: object): number {
  let changed = 0;
  for (const key of TOOL_PADDING_TARGET_KEYS) {
    if (removeHorizontalPadding(Reflect.get(component, key))) changed += 1;
  }
  return changed;
}
