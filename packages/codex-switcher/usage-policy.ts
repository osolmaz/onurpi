import type { UsageBucket, UsageMetric, UsageReport } from "@onurpi/pi-usage";

import type { BillingPolicy } from "./config.ts";

export type UsageDecision = "eligible" | "exhausted";

function normalize(value: string | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized === "" ? undefined : normalized;
}

function groupMatchesModel(
  group: string,
  bucket: UsageBucket | undefined,
  modelId: string,
): boolean {
  const model = normalize(modelId);
  if (!model) return false;
  const codexIndex = model.indexOf("codex");
  const modelKeys = new Set([model, ...(codexIndex >= 0 ? [model.slice(codexIndex)] : [])]);
  const keys = [group, bucket?.groupLabel, ...(bucket?.modelKeys ?? [])]
    .map(normalize)
    .filter((key): key is string => key !== undefined);
  return keys.some((key) => modelKeys.has(key));
}

function selectedGroup(report: UsageReport, modelId: string): string | undefined {
  const groups = [...new Set(report.buckets.map((bucket) => bucket.groupId ?? bucket.id))];
  for (const group of groups) {
    const bucket = report.buckets.find(
      (candidate) => (candidate.groupId ?? candidate.id) === group,
    );
    if (groupMatchesModel(group, bucket, modelId)) return group;
  }
  return groups.includes("codex") ? "codex" : groups[0];
}

function hasAvailableCredits(metrics: readonly UsageMetric[]): boolean {
  const credits = metrics.find((metric) => metric.id === "credits")?.value;
  return (
    credits === "available" ||
    credits === "unlimited" ||
    (typeof credits === "number" && credits > 0)
  );
}

export function usageDecision(
  report: UsageReport,
  modelId: string,
  billing: BillingPolicy,
): UsageDecision {
  const group = selectedGroup(report, modelId);
  if (!group) return "eligible";
  const buckets = report.buckets.filter((bucket) => (bucket.groupId ?? bucket.id) === group);
  const exhausted = buckets.some(
    (bucket) => bucket.remaining !== undefined && bucket.remaining <= 0,
  );
  if (!exhausted) return "eligible";
  if (billing === "allow-credits" && hasAvailableCredits(report.metrics)) return "eligible";
  return "exhausted";
}

export function minimumRemaining(report: UsageReport): number | undefined {
  const remaining = report.buckets
    .filter((bucket) => (bucket.groupId ?? bucket.id) === "codex")
    .map((bucket) => bucket.remaining)
    .filter((value): value is number => value !== undefined);
  return remaining.length > 0 ? Math.min(...remaining) : undefined;
}
