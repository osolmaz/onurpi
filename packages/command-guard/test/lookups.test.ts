import { describe, expect, it } from "vitest";

import { getBashParser } from "../src/bash-parser.ts";
import { classifyBash } from "../src/classifier.ts";
import { commandContext } from "../src/contexts.ts";
import { ExecutionCheckStore } from "../src/execution-check.ts";
import { evaluateCommand } from "../src/policy.ts";
import { guardExecCommand } from "../src/tool-calls.ts";

function decision(command: string) {
  return evaluateCommand(commandContext({ command, cwd: process.cwd(), shell: "bash" }));
}

describe("Bash command lookups", () => {
  it.each([
    "command -v pwsh",
    "command -V bash",
    "command -pv pwsh",
    "command -p -V bash",
    "command -v -- rm",
    "command -v rm /",
    'command -v "$UNSET_LOOKUP_TARGET"',
    "command -v",
    "builtin command -v pwsh",
    "command command -V bash",
    "command -v pwsh; git status --short",
  ])("allows lookup without treating its operands as executable: %s", async (source) => {
    const parser = await getBashParser();
    const result = await classifyBash(source, process.env, parser);
    expect(result.uncertainReason).toBeUndefined();
    expect(result.operations).toEqual([]);
    await expect(decision(source)).resolves.toMatchObject({ action: "allow" });
  });

  it.each([
    "command -v pwsh; rm -rf /",
    "command -v pwsh && rm -rf /",
    "command -v pwsh | command rm -rf /",
    "command -v pwsh > /",
    "command -v pwsh 2>| /",
    'command -v "$(rm -rf /)"',
    "command -v `rm -rf /`",
    "command -p rm -rf /",
    "command -- rm -rf /",
    "builtin command rm -rf /",
  ])("still blocks destructive execution and redirection: %s", async (source) => {
    await expect(decision(source)).resolves.toMatchObject({ action: "deny" });
  });

  it.each(["command -x pwsh", "command -v -x pwsh", "command -v --help pwsh"])(
    "does not interpret unknown options as a safe lookup: %s",
    async (source) => {
      await expect(decision(source)).resolves.toMatchObject({ action: "rewrite" });
    },
  );

  it.each(["clean", "reset", "checkout"])(
    "does not mistake a Git directory named %s for its subcommand",
    async (directory) => {
      await expect(decision(`git -C ${directory} reset --hard HEAD`)).resolves.toMatchObject({
        action: "rewrite",
      });
      await expect(decision(`git -C ${directory} status --short`)).resolves.toMatchObject({
        action: "allow",
      });
    },
  );

  it("allows a supported Bash check after an unrelated unsupported-shell failure", async () => {
    const checks = new ExecutionCheckStore();
    const cwd = process.cwd();
    const unsupported = await guardExecCommand(
      { toolCallId: "unsupported", input: { cmd: "echo safe", shell: "fish" } },
      { cwd },
      checks,
    );
    expect(unsupported).toMatchObject({ block: true });
    expect(unsupported?.reason).toContain("This result applies to this command");
    expect(checks.size).toBe(0);
    await expect(
      guardExecCommand(
        { toolCallId: "lookup", input: { cmd: "command -v pwsh", shell: "bash" } },
        { cwd },
        checks,
      ),
    ).resolves.toBeUndefined();
    expect(checks.size).toBe(1);
  });
});
