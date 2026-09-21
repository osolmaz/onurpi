import { describe, expect, it } from "vitest";

import { decideGate } from "./gate.ts";
import type { Lease } from "./store.ts";

function lease(sessionId: string): Lease {
  return {
    sessionId,
    pid: 1,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    cwd: "/tmp",
    admittedAt: "2026-09-21T05:00:00.000Z",
    heartbeatAt: "2026-09-21T05:00:00.000Z",
    stopRequestedAt: null,
  };
}

describe("decideGate", () => {
  it("continues and claims when the cap has room", () => {
    const decision = decideGate({
      enabled: true,
      holdsLease: false,
      live: [],
      maxAgents: 2,
      source: "interactive",
    });
    expect(decision).toEqual({ action: "continue", claim: true, count: 0, max: 2 });
  });

  it("rejects at the cap and reports the counts", () => {
    const decision = decideGate({
      enabled: true,
      holdsLease: false,
      live: [lease("a"), lease("b")],
      maxAgents: 2,
      source: "interactive",
    });
    expect(decision).toEqual({ action: "reject", count: 2, max: 2 });
  });

  it("continues for a session that already holds a lease", () => {
    const decision = decideGate({
      enabled: true,
      holdsLease: true,
      live: [lease("a"), lease("b")],
      maxAgents: 2,
      source: "rpc",
    });
    expect(decision).toEqual({ action: "continue", claim: false, count: 2, max: 2 });
  });

  it("lets another package's prompt through without claiming", () => {
    const decision = decideGate({
      enabled: true,
      holdsLease: false,
      live: [lease("a"), lease("b")],
      maxAgents: 2,
      source: "extension",
    });
    expect(decision).toEqual({ action: "continue", claim: false, count: 2, max: 2 });
  });

  it("passes everything when the feature is off", () => {
    const decision = decideGate({
      enabled: false,
      holdsLease: false,
      live: [lease("a"), lease("b")],
      maxAgents: 2,
      source: "interactive",
    });
    expect(decision).toEqual({ action: "continue", claim: false, count: 2, max: 2 });
  });

  it("allows the last free slot", () => {
    const decision = decideGate({
      enabled: true,
      holdsLease: false,
      live: [lease("a")],
      maxAgents: 2,
      source: "interactive",
    });
    expect(decision.action).toBe("continue");
    expect(decision).toMatchObject({ claim: true, count: 1 });
  });
});
