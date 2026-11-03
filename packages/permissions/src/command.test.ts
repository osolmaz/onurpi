import { describe, expect, it } from "vitest";

import { OFF_TEXT, ON_TEXT, USAGE, statusText, parseCommand } from "./command.ts";
import { createPermissionState } from "./state.ts";

describe("parseCommand", () => {
  it("toggles with no word", () => {
    expect(parseCommand("")).toBe("toggle");
    expect(parseCommand("   ")).toBe("toggle");
  });

  it("reads the three named actions", () => {
    expect(parseCommand("on")).toBe("on");
    expect(parseCommand(" OFF ")).toBe("off");
    expect(parseCommand("status")).toBe("status");
  });

  it("rejects unknown words and extra words", () => {
    expect(parseCommand("maybe")).toBe("invalid");
    expect(parseCommand("on now")).toBe("invalid");
  });
});

describe("statusText", () => {
  it("reports the on state", () => {
    expect(statusText(createPermissionState(true))).toBe(ON_TEXT);
  });

  it("reports the off state and says how to turn the check on", () => {
    expect(statusText(createPermissionState(false))).toBe(OFF_TEXT);
    expect(OFF_TEXT).toContain("/permissions on");
  });
});

describe("USAGE", () => {
  it("names the three words", () => {
    expect(USAGE).toContain("on");
    expect(USAGE).toContain("off");
    expect(USAGE).toContain("status");
  });
});
