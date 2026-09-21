/**
 * The lease directory: one small JSON file per working session.
 *
 * Every claim is an exclusive create, so two sessions can never hold the same slot and a crash can
 * never leave a half-written lease. A lease is refreshed by a heartbeat and removed on release, by
 * pid liveness, or after the heartbeat goes stale.
 *
 * The directory is runtime user data owned by this package:
 * `~/.pi/agent/focus-mode/leases/`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LEASE_DIR_NAME = "focus-mode";
export const LEASE_SUBDIR_NAME = "leases";
export const LEASE_SUFFIX = ".json";

export type Lease = {
  sessionId: string;
  pid: number;
  sessionFile: string;
  cwd: string;
  admittedAt: string;
  heartbeatAt: string;
  stopRequestedAt: string | null;
};

export type ClaimResult = { status: "held"; lease: Lease } | { status: "taken" };

export type LeaseInput = {
  sessionId: string;
  pid: number;
  sessionFile: string;
  cwd: string;
  now: string;
};

/** `~/.pi/agent/focus-mode.json` gives `~/.pi/agent/focus-mode/leases`. */
export function leaseDir(configPath: string): string {
  return join(dirname(configPath), LEASE_DIR_NAME, LEASE_SUBDIR_NAME);
}

export function leaseFilePath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId}${LEASE_SUFFIX}`);
}

/**
 * A stable, filesystem-safe id for one session. The session file path is unique per session, so a
 * hash of it is unique too; a session without a file falls back to the process id.
 */
export function sessionSlug(sessionFile: string | undefined, pid: number): string {
  const source = sessionFile ?? `pid-${String(pid)}`;
  const hex = createHash("sha256").update(source).digest("hex");
  return `${hex.slice(0, 12)}-${String(pid)}`;
}

/** Short display form for the `/focus list` output. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 12);
}

export function isProcessAlive(pid: number, hasProcEntry = existsSync): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "linux" && hasProcEntry(`/proc/${String(pid)}`)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return isErrnoException(error) && error.code === "EPERM";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function buildLease(input: LeaseInput): Lease {
  return {
    sessionId: input.sessionId,
    pid: input.pid,
    sessionFile: input.sessionFile,
    cwd: input.cwd,
    admittedAt: input.now,
    heartbeatAt: input.now,
    stopRequestedAt: null,
  };
}

export function claim(dir: string, input: LeaseInput): ClaimResult {
  const lease = buildLease(input);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(leaseFilePath(dir, input.sessionId), serializeLease(lease), { flag: "wx" });
    return { status: "held", lease };
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") return { status: "taken" };
    throw error;
  }
}

export function serializeLease(lease: Lease): string {
  return `${JSON.stringify(lease, null, 2)}\n`;
}

function hasLeaseFields(record: Record<string, unknown>): boolean {
  for (const field of ["sessionId", "sessionFile", "cwd", "admittedAt", "heartbeatAt"]) {
    if (typeof record[field] !== "string") return false;
  }
  if (typeof record["pid"] !== "number") return false;
  const stop = record["stopRequestedAt"];
  return stop === null || stop === undefined || typeof stop === "string";
}

function parseLeaseValue(value: unknown): Lease | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasLeaseFields(record)) return undefined;
  const stop = record["stopRequestedAt"];
  return {
    sessionId: record["sessionId"] as string,
    pid: record["pid"] as number,
    sessionFile: record["sessionFile"] as string,
    cwd: record["cwd"] as string,
    admittedAt: record["admittedAt"] as string,
    heartbeatAt: record["heartbeatAt"] as string,
    stopRequestedAt: typeof stop === "string" ? stop : null,
  };
}

export function readLease(path: string): Lease | undefined {
  try {
    return parseLeaseValue(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

export type ListedLease = { path: string; lease: Lease };

/** Read every lease. A file that cannot be read or parsed is reported as corrupt. */
export function listLeases(dir: string): { leases: ListedLease[]; corrupt: string[] } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { leases: [], corrupt: [] };
  }
  const leases: ListedLease[] = [];
  const corrupt: string[] = [];
  for (const name of names) {
    if (!name.endsWith(LEASE_SUFFIX)) continue;
    const path = join(dir, name);
    const lease = readLease(path);
    if (lease === undefined) corrupt.push(path);
    else leases.push({ path, lease });
  }
  return { leases, corrupt };
}

export function readOwnLease(dir: string, sessionId: string): Lease | undefined {
  return readLease(leaseFilePath(dir, sessionId));
}

export function updateLease(dir: string, lease: Lease): boolean {
  if (!existsSync(leaseFilePath(dir, lease.sessionId))) return false;
  writeFileSync(leaseFilePath(dir, lease.sessionId), serializeLease(lease));
  return true;
}

export function refresh(dir: string, sessionId: string, now: string): boolean {
  const lease = readOwnLease(dir, sessionId);
  if (lease === undefined) return false;
  return updateLease(dir, { ...lease, heartbeatAt: now });
}

export function requestStop(dir: string, sessionId: string, now: string): boolean {
  const lease = readOwnLease(dir, sessionId);
  if (lease === undefined) return false;
  return updateLease(dir, { ...lease, stopRequestedAt: now });
}

export function release(dir: string, sessionId: string): void {
  rmSync(leaseFilePath(dir, sessionId), { force: true });
}

export function isStopRequested(lease: Lease | undefined): boolean {
  return lease !== undefined && lease.stopRequestedAt !== null;
}

/**
 * Remove corrupt leases, leases whose process is gone, and leases whose heartbeat is older than the
 * staleness window. Returns the removed session ids.
 */
export function sweep(
  dir: string,
  now: string,
  staleMs: number,
  alive: (pid: number) => boolean = (pid) => isProcessAlive(pid),
): string[] {
  const { leases, corrupt } = listLeases(dir);
  const removed: string[] = [];
  for (const path of corrupt) {
    rmSync(path, { force: true });
  }
  const nowMs = Date.parse(now);
  for (const { path, lease } of leases) {
    const heartbeatMs = Date.parse(lease.heartbeatAt);
    const stale = !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > staleMs;
    if (!alive(lease.pid) || stale) {
      rmSync(path, { force: true });
      removed.push(lease.sessionId);
    }
  }
  return removed;
}

/** One line per holder for `/focus list`: short id, pid, working directory, and age. */
export function describeLease(lease: Lease, now: string): string {
  const admittedMs = Date.parse(lease.admittedAt);
  const nowMs = Date.parse(now);
  const known = Number.isFinite(admittedMs) && Number.isFinite(nowMs);
  const ageSeconds = known ? Math.max(0, (nowMs - admittedMs) / 1000) : 0;
  return `${shortSessionId(lease.sessionId)} pid ${String(lease.pid)} ${lease.cwd} ${ageSeconds.toFixed(0)}s`;
}
