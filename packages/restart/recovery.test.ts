import { describe, expect, it } from "vitest";

import { manualRestartCommand, recoveryMessage, shellQuote } from "./recovery.ts";

describe("restart recovery", () => {
  it("quotes paths for display without executing a shell", () => {
    expect(shellQuote("/tmp/a b'$HOME.jsonl")).toBe("'/tmp/a b'\\''$HOME.jsonl'");
    expect(manualRestartCommand("/tmp/a b.jsonl")).toBe("pi --session '/tmp/a b.jsonl'");
  });

  it("bounds the reason and preserves the complete recovery command", () => {
    const sessionFile = `/tmp/${"s".repeat(2000)}'long.jsonl`;
    const message = recoveryMessage(sessionFile, "x".repeat(2000));
    expect(message).toContain(`Pi restart failed: ${"x".repeat(1000)}\n`);
    expect(message).not.toContain(`Pi restart failed: ${"x".repeat(1001)}`);
    expect(message).toContain(`Session: ${sessionFile}\n`);
    expect(message).toContain(`Resume with: ${manualRestartCommand(sessionFile)}`);
  });
});
