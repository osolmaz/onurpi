import { describe, expect, test } from "vitest";

import {
  createCeilingState,
  describe as describeState,
  parseCeilingCommand,
  requestCompaction,
} from "./ceiling.ts";

describe("requestCompaction", () => {
  test("requests compaction when tokens pass the ceiling", () => {
    const state = createCeilingState(272_000);
    expect(requestCompaction(state, { tokens: 272_001 })).toBe("requested");
  });

  test("stays quiet at or below the ceiling", () => {
    const state = createCeilingState(272_000);
    expect(requestCompaction(state, { tokens: 272_000 })).toBe("none");
    expect(requestCompaction(state, { tokens: 1000 })).toBe("none");
  });

  test("never triggers on unknown token counts", () => {
    const state = createCeilingState(272_000);
    expect(requestCompaction(state, { tokens: null })).toBe("none");
  });

  test("does not re-request while a compaction is in flight", () => {
    const state = createCeilingState(272_000);
    state.compactionInFlight = true;
    expect(requestCompaction(state, { tokens: 900_000 })).toBe("none");
  });

  test("does nothing when disabled", () => {
    const state = createCeilingState(272_000);
    state.enabled = false;
    expect(requestCompaction(state, { tokens: 900_000 })).toBe("none");
  });
});

describe("parseCeilingCommand", () => {
  test("status reports the current setting", () => {
    const state = createCeilingState();
    expect(parseCeilingCommand(state, "")).toEqual({ status: describeState(state) });
    expect(parseCeilingCommand(state, "status")).toEqual({ status: describeState(state) });
  });

  test("on and off toggle the state", () => {
    const state = createCeilingState();
    const off = parseCeilingCommand(state, "off");
    expect(off).toEqual({ state: { ...state, enabled: false } });
    const on = parseCeilingCommand(state, "on");
    expect(on).toEqual({ state: { ...state, enabled: true } });
  });

  test("a token count retargets and enables the ceiling", () => {
    const state = createCeilingState();
    state.enabled = false;
    const parsed = parseCeilingCommand(state, "400000");
    expect(parsed).toEqual({
      state: { enabled: true, ceilingTokens: 400_000, compactionInFlight: false },
    });
  });

  test("rejects junk and small numbers with a status message", () => {
    const state = createCeilingState();
    for (const bad of ["banana", "-5", "999"]) {
      const parsed = parseCeilingCommand(state, bad);
      expect("status" in parsed ? parsed.status : "").toContain("Context ceiling");
    }
  });
});
