import { describe, expect, it } from "vitest";

import { manualRestartCommand, recoveryMessage, shellQuote } from "./recovery.ts";

describe("restart recovery", () => {
  it("quotes paths for display without executing a shell", () => {
    expect(shellQuote("/tmp/a b'$HOME.jsonl")).toBe("'/tmp/a b'\\''$HOME.jsonl'");
    expect(manualRestartCommand("/tmp/a b.jsonl")).toBe("pi --session '/tmp/a b.jsonl'");
  });

  it("bounds recovery diagnostics", () => {
    const message = recoveryMessage(`/tmp/${"s".repeat(800)}.jsonl`, "x".repeat(800));
    expect(message.length).toBeLessThanOrEqual(1000);
    expect(message).toContain("Pi restart failed");
  });
});
