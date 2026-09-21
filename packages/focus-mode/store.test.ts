import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claim,
  describeLease,
  isProcessAlive,
  isStopRequested,
  leaseDir,
  leaseFilePath,
  listLeases,
  readLease,
  readOwnLease,
  refresh,
  release,
  requestStop,
  serializeLease,
  sessionSlug,
  shortSessionId,
  sweep,
  updateLease,
  type Lease,
} from "./store.ts";

const NOW = "2026-09-21T05:00:00.000Z";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "focus-mode-store-"));
}

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    sessionId: "aaaa1111-1",
    pid: 4242,
    sessionFile: "/tmp/a.jsonl",
    cwd: "/tmp",
    admittedAt: NOW,
    heartbeatAt: NOW,
    stopRequestedAt: null,
    ...overrides,
  };
}

function inputFor(lease: Lease): {
  sessionId: string;
  pid: number;
  sessionFile: string;
  cwd: string;
  now: string;
} {
  return {
    sessionId: lease.sessionId,
    pid: lease.pid,
    sessionFile: lease.sessionFile,
    cwd: lease.cwd,
    now: lease.admittedAt,
  };
}

describe("paths", () => {
  it("derives the lease directory from the config path", () => {
    expect(leaseDir("/home/user/.pi/agent/focus-mode.json")).toBe(
      "/home/user/.pi/agent/focus-mode/leases",
    );
    expect(leaseFilePath("/leases", "abc")).toBe("/leases/abc.json");
  });

  it("builds a stable per-session id", () => {
    const first = sessionSlug("/sessions/a.jsonl", 7);
    expect(first).toBe(sessionSlug("/sessions/a.jsonl", 7));
    expect(first).not.toBe(sessionSlug("/sessions/b.jsonl", 7));
    expect(first.endsWith("-7")).toBe(true);
    expect(sessionSlug(undefined, 9).endsWith("-9")).toBe(true);
    expect(shortSessionId(first)).toHaveLength(12);
  });
});

describe("claim", () => {
  it("creates the directory and holds the slot", () => {
    const dir = join(tempDir(), "leases");
    const lease = makeLease();
    const result = claim(dir, inputFor(lease));
    expect(result.status).toBe("held");
    expect(readOwnLease(dir, lease.sessionId)).toMatchObject({ pid: 4242, stopRequestedAt: null });
  });

  it("refuses a second claim for the same session", () => {
    const dir = tempDir();
    const lease = makeLease();
    expect(claim(dir, inputFor(lease)).status).toBe("held");
    expect(claim(dir, inputFor(lease)).status).toBe("taken");
  });

  it("lets another session take its own slot", () => {
    const dir = tempDir();
    expect(claim(dir, inputFor(makeLease())).status).toBe("held");
    expect(claim(dir, inputFor(makeLease({ sessionId: "bbbb2222-1" }))).status).toBe("held");
  });
});

describe("refresh, update, release", () => {
  it("moves the heartbeat forward", () => {
    const dir = tempDir();
    const lease = makeLease();
    claim(dir, inputFor(lease));
    expect(refresh(dir, lease.sessionId, "2026-09-21T05:00:05.000Z")).toBe(true);
    expect(readOwnLease(dir, lease.sessionId)?.heartbeatAt).toBe("2026-09-21T05:00:05.000Z");
  });

  it("reports a missing lease instead of throwing", () => {
    const dir = tempDir();
    expect(refresh(dir, "missing", NOW)).toBe(false);
    expect(requestStop(dir, "missing", NOW)).toBe(false);
    expect(updateLease(dir, makeLease())).toBe(false);
    expect(() => {
      release(dir, "missing");
    }).not.toThrow();
  });

  it("releases the slot and keeps the second release quiet", () => {
    const dir = tempDir();
    const lease = makeLease();
    claim(dir, inputFor(lease));
    release(dir, lease.sessionId);
    expect(readOwnLease(dir, lease.sessionId)).toBeUndefined();
    expect(() => {
      release(dir, lease.sessionId);
    }).not.toThrow();
  });

  it("round-trips a stop request", () => {
    const dir = tempDir();
    const lease = makeLease();
    claim(dir, inputFor(lease));
    expect(isStopRequested(readOwnLease(dir, lease.sessionId))).toBe(false);
    expect(requestStop(dir, lease.sessionId, "2026-09-21T05:00:09.000Z")).toBe(true);
    const stored = readOwnLease(dir, lease.sessionId);
    expect(isStopRequested(stored)).toBe(true);
    expect(stored?.stopRequestedAt).toBe("2026-09-21T05:00:09.000Z");
  });
});

describe("listing", () => {
  it("skips and reports a corrupt file", () => {
    const dir = tempDir();
    claim(dir, inputFor(makeLease()));
    writeFileSync(join(dir, "broken.json"), "{oops");
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const { leases, corrupt } = listLeases(dir);
    expect(leases).toHaveLength(1);
    expect(corrupt).toHaveLength(1);
  });

  it("returns nothing for a missing directory", () => {
    expect(listLeases(join(tempDir(), "absent"))).toEqual({ leases: [], corrupt: [] });
  });

  it("rejects a lease with the wrong shape", () => {
    const dir = tempDir();
    const path = join(dir, "odd.json");
    writeFileSync(path, JSON.stringify({ sessionId: "x" }));
    expect(readLease(path)).toBeUndefined();
    writeFileSync(path, JSON.stringify({ ...makeLease(), stopRequestedAt: 5 }));
    expect(readLease(path)).toBeUndefined();
  });

  it("describes one holder with id, pid, directory, and age", () => {
    const line = describeLease(makeLease(), "2026-09-21T05:00:30.000Z");
    expect(line).toContain("pid 4242");
    expect(line).toContain("/tmp");
    expect(line).toContain("30s");
  });

  it("treats an unparseable timestamp as age zero", () => {
    expect(describeLease(makeLease({ admittedAt: "never" }), NOW)).toContain("0s");
  });

  it("serializes a lease as JSON with a trailing newline", () => {
    expect(serializeLease(makeLease()).endsWith("}\n")).toBe(true);
  });
});

describe("sweep", () => {
  it("removes a lease whose process is gone", () => {
    const dir = tempDir();
    const lease = makeLease({ sessionId: "dead" });
    claim(dir, inputFor(lease));
    const removed = sweep(dir, NOW, 20000, () => false);
    expect(removed).toEqual(["dead"]);
    expect(existsSync(leaseFilePath(dir, "dead"))).toBe(false);
  });

  it("removes a lease with a stale heartbeat and keeps a fresh one", () => {
    const dir = tempDir();
    claim(dir, inputFor(makeLease({ sessionId: "stale" })));
    updateLease(dir, makeLease({ sessionId: "stale" }));
    claim(dir, inputFor(makeLease({ sessionId: "fresh" })));
    updateLease(dir, makeLease({ sessionId: "fresh", heartbeatAt: "2026-09-21T05:00:50.000Z" }));
    const removed = sweep(dir, "2026-09-21T05:01:00.000Z", 20000, () => true);
    expect(removed).toEqual(["stale"]);
    expect(readOwnLease(dir, "fresh")).toBeDefined();
  });

  it("removes a corrupt lease file and a lease with an unreadable heartbeat", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "nope");
    claim(dir, inputFor(makeLease({ sessionId: "odd" })));
    updateLease(dir, makeLease({ sessionId: "odd", heartbeatAt: "never" }));
    const removed = sweep(dir, NOW, 20000, () => true);
    expect(removed).toEqual(["odd"]);
    expect(listLeases(dir).corrupt).toEqual([]);
  });
});

describe("isProcessAlive", () => {
  it("rejects an impossible pid", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-5)).toBe(false);
  });

  it("accepts the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("falls back to the signal probe and sends no signal", () => {
    expect(isProcessAlive(process.pid, () => false)).toBe(true);
  });

  it("reports a very large pid as gone", () => {
    expect(isProcessAlive(4_000_000, () => false)).toBe(false);
  });
});
