import type {
  CodexUsageReport,
  NormalizedCredits,
  NormalizedRateLimitResetCredit,
  NormalizedRateLimitResetCredits,
  NormalizedRateLimitSnapshot,
  NormalizedRateLimitWindow,
  UsageSource,
} from "./types.js";

export function normalizeBackendPayload(
  payload: unknown,
  capturedAt: number,
  source: UsageSource,
): CodexUsageReport {
  const data = assertObject(payload, "Codex usage payload");
  const snapshots: NormalizedRateLimitSnapshot[] = [];
  const primary = normalizeBackendSnapshot("codex", undefined, data["rate_limit"], data["credits"]);
  if (primary) snapshots.push(primary);

  const additional = Array.isArray(data["additional_rate_limits"])
    ? data["additional_rate_limits"]
    : [];
  for (const item of additional) addBackendSnapshot(snapshots, item);

  const resetCredits = normalizeBackendRateLimitResetCredits(data["rate_limit_reset_credits"]);
  if (snapshots.length === 0 && !resetCredits) {
    throw new Error("Codex usage endpoint returned no displayable usage data.");
  }

  const report: CodexUsageReport = { source, capturedAt, snapshots };
  assignOptional(report, "planType", asString(data["plan_type"]));
  assignOptional(report, "resetCredits", resetCredits);
  return report;
}

function addBackendSnapshot(snapshots: NormalizedRateLimitSnapshot[], value: unknown): void {
  const item = asObject(value);
  if (!item) return;
  const limitId = asString(item["metered_feature"]) ?? asString(item["limit_name"]);
  if (!limitId) return;

  try {
    const snapshot = normalizeBackendSnapshot(
      limitId,
      asString(item["limit_name"]),
      item["rate_limit"],
      undefined,
    );
    if (snapshot) snapshots.push(snapshot);
  } catch {
    // Optional additional buckets must not hide otherwise usable primary/reset usage.
  }
}

function normalizeBackendSnapshot(
  limitId: string,
  limitName: string | undefined,
  rateLimit: unknown,
  credits: unknown,
): NormalizedRateLimitSnapshot | undefined {
  if (rateLimit === null || rateLimit === undefined) {
    const normalizedCredits = normalizeBackendCredits(credits);
    return normalizedCredits
      ? createSnapshot(limitId, limitName, undefined, undefined, normalizedCredits)
      : undefined;
  }

  const details = assertObject(rateLimit, "rate limit");
  const primary = normalizeBackendWindow(details["primary_window"]);
  const secondary = normalizeBackendWindow(details["secondary_window"]);
  const normalizedCredits = normalizeBackendCredits(credits);
  if (!primary && !secondary && !normalizedCredits) return undefined;
  return createSnapshot(limitId, limitName, primary, secondary, normalizedCredits);
}

function normalizeBackendWindow(value: unknown): NormalizedRateLimitWindow | undefined {
  if (value === null || value === undefined) return undefined;
  const window = assertObject(value, "rate-limit window");
  const usedPercent = asNumber(window["used_percent"]);
  if (usedPercent === undefined) return undefined;

  const result: NormalizedRateLimitWindow = { usedPercent };
  const limitSeconds = asNumber(window["limit_window_seconds"]);
  if (limitSeconds !== undefined && limitSeconds > 0) {
    result.windowMinutes = Math.ceil(limitSeconds / 60);
  }
  assignOptional(result, "resetsAt", asNumber(window["reset_at"]));
  return result;
}

function normalizeBackendCredits(value: unknown): NormalizedCredits | undefined {
  if (value === null || value === undefined) return undefined;
  const credits = assertObject(value, "credits");
  const hasCredits = asBoolean(credits["has_credits"]);
  const unlimited = asBoolean(credits["unlimited"]);
  if (hasCredits === undefined || unlimited === undefined) return undefined;

  const result: NormalizedCredits = { hasCredits, unlimited };
  assignOptional(result, "balance", asString(credits["balance"]));
  return result;
}

function normalizeBackendRateLimitResetCredits(
  value: unknown,
): NormalizedRateLimitResetCredits | undefined {
  const resetCredits = asObject(value);
  const availableCount = asNonnegativeInteger(resetCredits?.["available_count"]);
  return availableCount === undefined ? undefined : { availableCount };
}

export function normalizeAppServerResponse(
  response: unknown,
  capturedAt: number,
): CodexUsageReport {
  const data = assertObject(response, "codex app-server response");
  const snapshots: NormalizedRateLimitSnapshot[] = [];
  addAppServerSnapshot(snapshots, data["rateLimits"], "codex");

  const snapshotsByLimitId = asObject(data["rateLimitsByLimitId"]);
  if (snapshotsByLimitId) {
    for (const [limitId, raw] of Object.entries(snapshotsByLimitId)) {
      if (limitId) addAppServerSnapshot(snapshots, raw, limitId, true);
    }
  }

  const resetCredits = normalizeAppServerRateLimitResetCredits(data["rateLimitResetCredits"]);
  if (snapshots.length === 0 && !resetCredits) {
    throw new Error("codex app-server returned no displayable usage data.");
  }

  const report: CodexUsageReport = {
    source: "codex-app-server",
    capturedAt,
    snapshots,
  };
  assignOptional(report, "planType", readAppServerPlanType(data["rateLimits"]));
  assignOptional(report, "resetCredits", resetCredits);
  return report;
}

function addAppServerSnapshot(
  snapshots: NormalizedRateLimitSnapshot[],
  raw: unknown,
  fallbackId: string,
  optional = false,
): void {
  let snapshot: NormalizedRateLimitSnapshot | undefined;
  try {
    snapshot = normalizeAppServerSnapshot(raw, fallbackId);
  } catch (error) {
    if (optional) return;
    throw error;
  }
  if (!snapshot) return;

  const existingIndex = snapshots.findIndex((item) => item.limitId === snapshot.limitId);
  if (existingIndex < 0) {
    snapshots.push(snapshot);
    return;
  }
  const existing = snapshots[existingIndex];
  if (existing) snapshots[existingIndex] = mergeSnapshot(existing, snapshot);
}

function readAppServerPlanType(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const snapshot = assertObject(value, "app-server rate-limit snapshot");
  return asString(snapshot["planType"]);
}

function normalizeAppServerSnapshot(
  raw: unknown,
  fallbackId: string,
): NormalizedRateLimitSnapshot | undefined {
  if (raw === null || raw === undefined) return undefined;
  const snapshot = assertObject(raw, "app-server rate-limit snapshot");
  const limitId = asString(snapshot["limitId"]) ?? fallbackId;
  const limitName = asString(snapshot["limitName"]);
  const primary = normalizeAppServerWindow(snapshot["primary"]);
  const secondary = normalizeAppServerWindow(snapshot["secondary"]);
  const credits = normalizeAppServerCredits(snapshot["credits"]);
  if (!primary && !secondary && !credits) return undefined;
  return createSnapshot(limitId, limitName, primary, secondary, credits);
}

function normalizeAppServerWindow(value: unknown): NormalizedRateLimitWindow | undefined {
  if (value === null || value === undefined) return undefined;
  const window = assertObject(value, "app-server rate-limit window");
  const usedPercent = asNumber(window["usedPercent"]);
  if (usedPercent === undefined) return undefined;

  const result: NormalizedRateLimitWindow = { usedPercent };
  assignOptional(result, "windowMinutes", asNumber(window["windowDurationMins"]));
  assignOptional(result, "resetsAt", asNumber(window["resetsAt"]));
  return result;
}

function normalizeAppServerCredits(value: unknown): NormalizedCredits | undefined {
  if (value === null || value === undefined) return undefined;
  const credits = assertObject(value, "app-server credits");
  const hasCredits = asBoolean(credits["hasCredits"]);
  const unlimited = asBoolean(credits["unlimited"]);
  if (hasCredits === undefined || unlimited === undefined) return undefined;

  const result: NormalizedCredits = { hasCredits, unlimited };
  assignOptional(result, "balance", asString(credits["balance"]));
  return result;
}

function normalizeAppServerRateLimitResetCredits(
  value: unknown,
): NormalizedRateLimitResetCredits | undefined {
  const resetCredits = asObject(value);
  const availableCount = asNonnegativeInteger(resetCredits?.["availableCount"]);
  if (availableCount === undefined) return undefined;

  const rawCredits = resetCredits?.["credits"];
  if (!Array.isArray(rawCredits)) return { availableCount };
  const credits = rawCredits
    .map(normalizeAppServerRateLimitResetCredit)
    .filter((credit): credit is NormalizedRateLimitResetCredit => credit !== undefined)
    .slice(0, availableCount);
  return rawCredits.length > 0 && credits.length === 0 && availableCount > 0
    ? { availableCount }
    : { availableCount, credits };
}

function normalizeAppServerRateLimitResetCredit(
  value: unknown,
): NormalizedRateLimitResetCredit | undefined {
  const credit = asObject(value);
  if (!credit) return undefined;
  const id = asString(credit["id"]);
  if (!id) return undefined;

  const normalized: NormalizedRateLimitResetCredit = { id };
  assignOptional(normalized, "resetType", asString(credit["resetType"]));
  assignOptional(normalized, "status", asString(credit["status"]));
  assignOptional(normalized, "grantedAt", asNumber(credit["grantedAt"]));
  assignOptional(normalized, "expiresAt", asNumber(credit["expiresAt"]));
  assignOptional(normalized, "title", asString(credit["title"]));
  assignOptional(normalized, "description", asString(credit["description"]));
  return normalized;
}

function createSnapshot(
  limitId: string,
  limitName: string | undefined,
  primary: NormalizedRateLimitWindow | undefined,
  secondary: NormalizedRateLimitWindow | undefined,
  credits: NormalizedCredits | undefined,
): NormalizedRateLimitSnapshot {
  const snapshot: NormalizedRateLimitSnapshot = { limitId };
  assignOptional(snapshot, "limitName", limitName);
  assignOptional(snapshot, "primary", primary);
  assignOptional(snapshot, "secondary", secondary);
  assignOptional(snapshot, "credits", credits);
  return snapshot;
}

function mergeSnapshot(
  left: NormalizedRateLimitSnapshot,
  right: NormalizedRateLimitSnapshot,
): NormalizedRateLimitSnapshot {
  return createSnapshot(
    right.limitId,
    right.limitName ?? left.limitName,
    right.primary ?? left.primary,
    right.secondary ?? left.secondary,
    right.credits ?? left.credits,
  );
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function assertObject(value: unknown, description: string): Record<string, unknown> {
  const object = asObject(value);
  if (!object) throw new Error(`${description} was not an object.`);
  return object;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return isUnknownRecord(value) ? value : undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNonnegativeInteger(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed)) return undefined;
  return Math.max(0, parsed);
}
