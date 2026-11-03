import { describe, expect, it } from "vitest";

import { describeCall, MAX_DETAIL_LENGTH, showHiddenCharacters } from "./summary.ts";

describe("describeCall", () => {
  it("names the tool and its command", () => {
    expect(describeCall("bash", { command: "npm test" })).toBe("bash: npm test");
  });

  it("uses the cmd word of a unified exec call", () => {
    expect(describeCall("exec_command", { cmd: "ls -la" })).toBe("exec_command: ls -la");
  });

  it("shows the script of a codemode call", () => {
    expect(describeCall("codemode", { code: "return 1 + 1;" })).toBe("codemode: return 1 + 1;");
  });

  it("shows the input written to a session instead of the session id", () => {
    expect(describeCall("write_stdin", { session_id: 3, chars: "y\r" })).toBe(
      "write_stdin: y\\x0d",
    );
    expect(describeCall("write_stdin", { session_id: 3, chars_b64: "eQ==" })).toBe(
      "write_stdin: eQ==",
    );
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

  it("shows an empty input as an empty object", () => {
    expect(describeCall("update_plan", {})).toBe("update_plan: {}");
    expect(describeCall("bash", { command: "   " })).toBe('bash: {"command":" "}');
  });

  it("shows escape characters instead of sending them to the terminal", () => {
    expect(describeCall("bash", { command: "ls \u001b[8m; rm -rf ~" })).toBe(
      "bash: ls \\x1b[8m; rm -rf ~",
    );
  });

  it("shows a bidirectional override", () => {
    expect(describeCall("bash", { command: "ls \u202egnp.exe" })).toBe("bash: ls \\u202egnp.exe");
  });

  it("collapses runs of spaces", () => {
    expect(describeCall("bash", { command: "a   b" })).toBe("bash: a b");
  });

  it("escapes a newline and a tab", () => {
    expect(describeCall("bash", { command: "a\n\n  b\tc" })).toBe("bash: a\\x0a\\x0a b\\x09c");
  });

  it("marks a shortened command", () => {
    const command = "+".repeat(MAX_DETAIL_LENGTH + 40);
    const summary = describeCall("bash", { command });
    expect(summary).toBe(`bash: ${"+".repeat(MAX_DETAIL_LENGTH)}... [truncated]`);
  });
});

describe("showHiddenCharacters", () => {
  it("leaves ordinary text alone", () => {
    expect(showHiddenCharacters("plain text")).toBe("plain text");
  });

  it("escapes a delete and a zero-width space", () => {
    expect(showHiddenCharacters("a\u007fb\u200bc")).toBe("a\\x7fb\\u200bc");
  });
});
