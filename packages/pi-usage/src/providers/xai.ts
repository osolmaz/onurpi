import { sanitizeDisplayText } from "../core.js";
import type { UsageBucket, UsageMetric, UsageReport, XaiBillingPayload } from "../types.js";

const WEEKLY_PERIOD = "weekly";
const MONTHLY_PERIOD = "monthly";

export function normalizeXaiBillingPayload(
  payload: XaiBillingPayload,
  capturedAt: number,
): UsageReport {
  const config = asObject(payload.config);
  if (!config) throw new Error("xAI billing response config was not an object.");

  const context = periodContext(config);
  const buckets = [...optionalList(weeklyBucket(context)), ...productBuckets(config, context)];
  const metrics = usdMetrics(config);
  const notes = billingNotes(config, context.weeklyUsed);

  if (buckets.length === 0 && metrics.length === 0 && notes.length === 0) {
    throw new Error("xAI billing endpoint returned no displayable usage data.");
  }

  return {
    providerId: "xai",
    providerName: "xAI",
    capturedAt,
    source: "grok-cli-billing",
    semantics: {
      kind: "consumer-subscription",
      label: "Grok/X subscription limits",
    },
    buckets,
    metrics,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

type PeriodContext = {
  periodName: string | undefined;
  resetsAt: number | undefined;
  windowMinutes: number | undefined;
  weeklyUsed: number | undefined;
  hasWindow: boolean;
};

function periodContext(config: Record<string, unknown>): PeriodContext {
  const period = asObject(config["currentPeriod"]);
  const weeklyUsed = asPercent(config["creditUsagePercent"]);
  const resetsAt = asEpochSeconds(period?.["end"] ?? config["billingPeriodEnd"]);
  return {
    periodName: periodNameFromType(asString(period?.["type"])),
    resetsAt,
    windowMinutes: windowMinutesFromPeriod(period),
    weeklyUsed,
    hasWindow: Boolean(period) || resetsAt !== undefined || weeklyUsed !== undefined,
  };
}

function weeklyBucket(context: PeriodContext): UsageBucket | undefined {
  if (!context.hasWindow) return undefined;
  return {
    id: "weekly-credits",
    label: "Weekly credits",
    ...percentFields(context.weeklyUsed),
    unit: "percent",
    period: context.periodName ?? WEEKLY_PERIOD,
    ...(context.windowMinutes !== undefined ? { windowMinutes: context.windowMinutes } : {}),
    ...(context.resetsAt !== undefined ? { resetsAt: context.resetsAt } : {}),
  };
}

function productBuckets(config: Record<string, unknown>, context: PeriodContext): UsageBucket[] {
  const products = Array.isArray(config["productUsage"]) ? config["productUsage"] : [];
  const buckets: UsageBucket[] = [];
  for (const item of products) {
    const bucket = productBucket(item, context);
    if (bucket) buckets.push(bucket);
  }
  return buckets;
}

function productBucket(item: unknown, context: PeriodContext): UsageBucket | undefined {
  const product = asObject(item);
  const name = asString(product?.["product"]);
  const used = asPercent(product?.["usagePercent"]);
  if (!name || used === undefined) return undefined;
  return {
    id: `product:${normalizeKey(name)}`,
    label: humanizeProductName(name),
    ...percentFields(used),
    unit: "percent",
    ...(context.periodName ? { period: context.periodName } : {}),
    ...(context.resetsAt !== undefined ? { resetsAt: context.resetsAt } : {}),
  };
}

function usdMetrics(config: Record<string, unknown>): UsageMetric[] {
  const metrics: UsageMetric[] = [];
  addUsdMetric(metrics, "on-demand-used", "On-demand used", config["onDemandUsed"]);
  addUsdMetric(metrics, "on-demand-cap", "On-demand cap", config["onDemandCap"]);
  addUsdMetric(metrics, "prepaid-balance", "Prepaid balance", config["prepaidBalance"]);
  return metrics;
}

function billingNotes(config: Record<string, unknown>, weeklyUsed: number | undefined): string[] {
  if (config["isUnifiedBillingUser"] === true && weeklyUsed === undefined) {
    return ["Weekly remaining percent was not returned for this account."];
  }
  return [];
}

function percentFields(used: number | undefined): Partial<UsageBucket> {
  if (used === undefined) return {};
  return { used, remaining: Math.max(0, 100 - used), limit: 100 };
}

function optionalList<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function addUsdMetric(metrics: UsageMetric[], id: string, label: string, value: unknown): void {
  const amount = asUsdFromCents(value);
  if (amount === undefined) return;
  metrics.push({ id, label, value: amount, unit: "usd" });
}

function periodNameFromType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = normalizeKey(value);
  if (key.includes("weekly")) return WEEKLY_PERIOD;
  if (key.includes("monthly")) return MONTHLY_PERIOD;
  return sanitizeDisplayText(value, 32) || undefined;
}

function windowMinutesFromPeriod(period: Record<string, unknown> | undefined): number | undefined {
  const start = asEpochSeconds(period?.["start"]);
  const end = asEpochSeconds(period?.["end"]);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return Math.round((end - start) / 60);
}

function humanizeProductName(value: string): string {
  const known: Record<string, string> = {
    grokbuild: "Grok Build",
    grokchat: "Grok Chat",
    grokimagine: "Grok Imagine",
    grokapi: "Grok API",
  };
  return known[normalizeKey(value)] ?? sanitizeDisplayText(value, 40) ?? value;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return sanitizeDisplayText(value, 80) || undefined;
}

function asPercent(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clampPercent(parsed);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clampPercent(value);
}

function asUsdFromCents(value: unknown): number | undefined {
  const cents = asObject(value)?.["val"];
  if (typeof cents !== "number" || !Number.isFinite(cents) || !Number.isInteger(cents)) {
    return undefined;
  }
  return Math.abs(cents) / 100;
}

function asEpochSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return Math.floor(ms / 1000);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
