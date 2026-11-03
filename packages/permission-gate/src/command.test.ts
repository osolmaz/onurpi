import { describe, expect, it } from "vitest";

import {
  GATE_OFF_TEXT,
  GATE_ON_TEXT,
  GATE_USAGE,
  gateStatusText,
  parseGateCommand,
} from "./command.ts";
import { createGateState } from "./gate-state.ts";

describe("parseGateCommand", () => {
  it("toggles with no word", () => {
    expect(parseGateCommand("")).toBe("toggle");
    expect(parseGateCommand("   ")).toBe("toggle");
  });

  it("reads the three named actions", () => {
    expect(parseGateCommand("on")).toBe("on");
    expect(parseGateCommand(" OFF ")).toBe("off");
    expect(parseGateCommand("status")).toBe("status");
  });

  it("rejects unknown words and extra words", () => {
    expect(parseGateCommand("maybe")).toBe("invalid");
    expect(parseGateCommand("on now")).toBe("invalid");
  });
});

describe("gateStatusText", () => {
  it("reports the on state and the allowed tools", () => {
    const state = createGateState(true);
    state.allowedTools.add("write");
    state.allowedTools.add("bash");
    expect(gateStatusText(state)).toBe(
      `${GATE_ON_TEXT}\nAllowed for this session without asking: bash, write.`,
    );
  });

  it("reports the off state with no allowed tools", () => {
    expect(gateStatusText(createGateState(false))).toBe(
      `${GATE_OFF_TEXT}\nAllowed for this session without asking: none.`,
    );
  });
});

describe("GATE_USAGE", () => {
  it("names the three words", () => {
    expect(GATE_USAGE).toContain("on");
    expect(GATE_USAGE).toContain("off");
    expect(GATE_USAGE).toContain("status");
  });
});
