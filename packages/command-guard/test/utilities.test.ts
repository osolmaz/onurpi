import { describe, expect, it } from "vitest";

import { commandEnvironmentEvent } from "@onurpi/unified-exec/command-environment";
import { commandInputEvent } from "@onurpi/unified-exec/command-input";

import { commandField, hasCommandSchema } from "../src/adapters.ts";
import { commandContext, defaultShell } from "../src/contexts.ts";
import {
  isCommandEnvironmentEvent,
  isCommandInputEvent,
  isControlOnlyInput,
} from "../src/events.ts";
import { hasPossibleDestructiveToken } from "../src/lexical.ts";
import { shellKind } from "../src/shell.ts";

describe("adapter helpers", () => {
  it("detects command-shaped schemas and inputs", () => {
    expect(hasCommandSchema({ parameters: { properties: { cmd: { type: "string" } } } })).toBe(
      true,
    );
    expect(hasCommandSchema({ parameters: { properties: { query: { type: "string" } } } })).toBe(
      false,
    );
    expect(hasCommandSchema({ parameters: undefined })).toBe(false);
    expect(commandField({ script: "echo safe" })).toBe("echo safe");
    expect(commandField({ command: 1 })).toBeUndefined();
  });

  it("validates unified-exec events and control bytes", () => {
    const environment = commandEnvironmentEvent(
      "call",
      "invocation",
      "echo safe",
      "/tmp",
      "bash",
      undefined,
      {},
    );
    const input = commandInputEvent("call", 1, "cat", "/tmp", "bash", true, new Uint8Array([3]));
    expect(isCommandEnvironmentEvent(environment)).toBe(true);
    expect(isCommandEnvironmentEvent({})).toBe(false);
    expect(isCommandInputEvent(input)).toBe(true);
    expect(isCommandInputEvent({})).toBe(false);
    expect(isControlOnlyInput(new Uint8Array([3, 4]))).toBe(true);
    expect(isControlOnlyInput(new Uint8Array())).toBe(false);
    expect(isControlOnlyInput(new Uint8Array([3, 65]))).toBe(false);
  });
});

describe("shell and message helpers", () => {
  it("identifies supported shells", () => {
    expect(shellKind("/bin/bash")).toBe("bash");
    expect(shellKind("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("bash");
    expect(shellKind("pwsh.exe")).toBe("powershell");
    expect(shellKind("cmd.exe")).toBe("cmd");
    expect(shellKind("fish")).toBe("unknown");
    expect(defaultShell({ SHELL: "/bin/zsh" })).toBe("/bin/zsh");
    expect(defaultShell({})).toBe("bash");
    expect(commandContext({ command: "pwd", cwd: ".", shell: "bash" }).shellKind).toBe("bash");
    expect(
      commandContext({ command: "pwd", cwd: ".", environment: { SHELL: "sh" } }),
    ).toMatchObject({
      shell: "sh",
      shellKind: "bash",
    });
  });

  it("detects covered destructive words without matching partial words", () => {
    expect(hasPossibleDestructiveToken("rm -rf target")).toBe(true);
    expect(hasPossibleDestructiveToken("Remove-Item target")).toBe(true);
    expect(hasPossibleDestructiveToken("format string")).toBe(false);
  });
});
