import { describe, expect, it } from "vitest";

import {
  describeCall,
  MAX_DETAIL_LENGTH,
  MAX_FIELD_LENGTH,
  showHiddenCharacters,
} from "./summary.ts";

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

  it("shows the other fields that change what runs", () => {
    expect(describeCall("exec_command", { cmd: "ls", shell: "/tmp/x", workdir: "/etc" })).toBe(
      "exec_command: ls | shell=/tmp/x | workdir=/etc",
    );
  });

  it("shows an unknown field too", () => {
    expect(describeCall("clip", { name: "x", count: 2 })).toBe("clip: name=x | count=2");
  });

  it("shows the input written to a session instead of the session id", () => {
    expect(describeCall("write_stdin", { session_id: 3, chars: "y\r" })).toBe(
      "write_stdin: y\\x0d | session_id=3",
    );
  });

  it("shows a lone carriage return, which is what a bare Enter sends", () => {
    expect(describeCall("write_stdin", { session_id: 3, chars: "\r" })).toBe(
      "write_stdin: \\x0d | session_id=3",
    );
  });

  it("decodes base64 input to the text it stands for", () => {
    expect(describeCall("write_stdin", { session_id: 3, chars_b64: "eQ==" })).toBe(
      "write_stdin: y | session_id=3",
    );
  });

  it("shows the path of a file call and its content", () => {
    expect(describeCall("write", { path: "a/b.txt", content: "hello" })).toBe(
      "write: a/b.txt | content=hello",
    );
  });

  it("reports an empty input", () => {
    expect(describeCall("update_plan", {})).toBe("update_plan: (empty input)");
  });

  it("shows escape characters instead of sending them to the terminal", () => {
    expect(describeCall("bash", { command: "ls \u001b[8m; rm -rf ~" })).toBe(
      "bash: ls \\x1b[8m; rm -rf ~",
    );
  });

  it("shows a bidirectional override and a backslash", () => {
    expect(describeCall("bash", { command: "ls \u202egnp.exe" })).toBe("bash: ls \\u202egnp.exe");
    expect(describeCall("bash", { command: "echo \\x1b" })).toBe("bash: echo \\\\x1b");
  });

  it("collapses runs of spaces", () => {
    expect(describeCall("bash", { command: "a   b" })).toBe("bash: a b");
  });

  it("cuts a long field and says how much is left", () => {
    const content = "x".repeat(MAX_FIELD_LENGTH + 40);
    const summary = describeCall("write", { path: "a.txt", content });
    expect(summary).toContain("[40 more characters]");
  });

  it("marks a description that is cut as a whole", () => {
    const content = "+".repeat(MAX_DETAIL_LENGTH * 3);
    const summary = describeCall("write", { path: "a.txt", content });
    expect(summary).toContain("more characters]");
    expect(summary.length).toBeLessThanOrEqual(MAX_DETAIL_LENGTH + 40);
  });
});

describe("showHiddenCharacters", () => {
  it("leaves ordinary text alone", () => {
    expect(showHiddenCharacters("plain text")).toBe("plain text");
  });

  it("escapes controls, format characters, and astral ignorables", () => {
    expect(showHiddenCharacters("a\u007fb\u200bc")).toBe("a\\x7fb\\u200bc");
    expect(showHiddenCharacters("\u{e0041}")).toBe("\\u{e0041}");
  });
});
