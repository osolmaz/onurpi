import { describe, expect, it } from "vitest";

import { decideConvergence } from "./converge.ts";
import type { Lease } from "./store.ts";

function lease(sessionId: string, admittedAt: string): Lease {
  return {
    sessionId,
    pid: 1,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    cwd: "/tmp",
    admittedAt,
    heartbeatAt: admittedAt,
    stopRequestedAt: null,
  };
}

const OLD = lease("old", "2026-09-21T05:00:00.000Z");
const MIDDLE = lease("middle", "2026-09-21T05:00:10.000Z");
const NEW = lease("new", "2026-09-21T05:00:20.000Z");

describe("decideConvergence", () => {
  it("keeps everything at or below the cap", () => {
    expect(
      decideConvergence({ live: [OLD, NEW], sessionId: "new", maxAgents: 2, policy: "newest" }),
    ).toEqual({ action: "keep" });
  });

  it("asks the newest holder to stop when another session is over the cap", () => {
    const decision = decideConvergence({
      live: [OLD, MIDDLE, NEW],
      sessionId: "old",
      maxAgents: 2,
      policy: "newest",
    });
    expect(decision).toEqual({ action: "request-stop", victim: NEW });
  });

  it("stops itself when it is the newest holder", () => {
    const decision = decideConvergence({
      live: [OLD, MIDDLE, NEW],
      sessionId: "new",
      maxAgents: 2,
      policy: "newest",
    });
    expect(decision).toEqual({ action: "stop-self" });
  });

  it("flips the victim under the oldest policy", () => {
    const decision = decideConvergence({
      live: [OLD, MIDDLE, NEW],
      sessionId: "new",
      maxAgents: 2,
      policy: "oldest",
    });
    expect(decision).toEqual({ action: "request-stop", victim: OLD });
  });

  it("agrees on one victim across sessions", () => {
    const live = [OLD, MIDDLE, NEW];
    const fromOld = decideConvergence({ live, sessionId: "old", maxAgents: 2, policy: "newest" });
    const fromMiddle = decideConvergence({
      live,
      sessionId: "middle",
      maxAgents: 2,
      policy: "newest",
    });
    expect(fromOld).toEqual(fromMiddle);
  });

  it("breaks a time tie on the larger session id", () => {
    const sameTimeA = lease("aaa", "2026-09-21T05:00:30.000Z");
    const sameTimeB = lease("bbb", "2026-09-21T05:00:30.000Z");
    const decision = decideConvergence({
      live: [sameTimeA, sameTimeB, OLD],
      sessionId: "old",
      maxAgents: 2,
      policy: "newest",
    });
    expect(decision).toEqual({ action: "request-stop", victim: sameTimeB });
  });

  it("finds no victim in an empty list", () => {
    expect(
      decideConvergence({ live: [], sessionId: "any", maxAgents: 0, policy: "newest" }),
    ).toEqual({ action: "keep" });
  });
});
