import { describe, expect, it } from "vitest";

import { describeCall, MAX_DETAIL_LENGTH } from "./summary.ts";

describe("describeCall", () => {
  it("names the tool and its command", () => {
    expect(describeCall("bash", { command: "npm test" })).toBe("bash: npm test");
  });

  it("uses the cmd word of a unified exec call", () => {
    expect(describeCall("exec_command", { cmd: "ls -la" })).toBe("exec_command: ls -la");
  });

  it("uses the path of a file call", () => {
    expect(describeCall("write", { path: "a/b.txt", content: "x" })).toBe("write: a/b.txt");
  });

  it("prefers the command over other words", () => {
    expect(describeCall("bash", { command: "run", path: "ignored" })).toBe("bash: run");
  });

  it("falls back to the input when it has no known word", () => {
    expect(describeCall("clip", { name: "x", count: 2 })).toBe('clip: {"name":"x","count":2}');
  });

  it("returns the tool name for empty input", () => {
    expect(describeCall("update_plan", {})).toBe("update_plan: {}");
    expect(describeCall("bash", { command: "   " })).toBe('bash: {"command":" "}');
  });

  it("collapses whitespace", () => {
    expect(describeCall("bash", { command: "a\n\n  b\tc" })).toBe("bash: a b c");
  });

  it("shortens a long command", () => {
    const command = "x".repeat(MAX_DETAIL_LENGTH + 40);
    const summary = describeCall("bash", { command });
    expect(summary).toBe(`bash: ${"x".repeat(MAX_DETAIL_LENGTH)}...`);
  });
});
