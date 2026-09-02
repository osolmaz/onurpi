import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  commandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
} from "@onurpi/unified-exec/command-environment";
import { runFinalSpawnPolicies } from "@onurpi/unified-exec/command-policy";

import { ApprovalStore } from "../src/approval.ts";
import { guardedOperations } from "../src/builtins.ts";
import { commandContext } from "../src/contexts.ts";
import { evaluateCommand } from "../src/policy.ts";
import { guardExecCommand } from "../src/tool-calls.ts";
import { registerUnifiedExecGuards } from "../src/unified-adapter.ts";

const INCIDENT = 'HOME=$(mktemp -d) command; rm -rf "$HOME"';
let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-incident-"));
});

function approvalContext() {
  return {
    cwd: directory,
    hasUI: true,
    signal: undefined,
    ui: { confirm: vi.fn(() => Promise.resolve(true)) },
  };
}

describe("HOME cleanup incident regression", () => {
  it("blocks temporary and persistent HOME assignment variants", async () => {
    const environment = { ...process.env, HOME: "/home/test-owner" };
    const commands = [
      INCIDENT,
      'HOME=$(mktemp -d) true; command rm -rf -- "$HOME"',
      'env HOME="$(mktemp -d)" true; rm -rf "$HOME"',
      'HOME="$(mktemp -d)"\ntrue\nrm -rf "$HOME"',
    ];

    for (const command of commands) {
      await expect(
        evaluateCommand(commandContext({ command, cwd: directory, environment, shell: "bash" })),
        command,
      ).resolves.toMatchObject({ action: "rewrite" });
    }
  });

  it("does not delegate the incident through the guarded built-in shell", async () => {
    const exec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const context = approvalContext();
    const operations = guardedOperations({ exec }, "bash", context, new ApprovalStore());

    await expect(
      operations.exec(INCIDENT, directory, {
        env: { ...process.env, HOME: "/home/test-owner" },
        onData: vi.fn(),
      }),
    ).rejects.toThrow("variable HOME is assigned in the script");
    expect(context.ui.confirm).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("blocks the incident at Unified Exec preflight and final spawn", async () => {
    const approvals = new ApprovalStore();
    const context = approvalContext();
    const blocked = await guardExecCommand(
      { toolCallId: "incident", input: { cmd: INCIDENT, shell: "bash" } },
      context,
      approvals,
    );
    expect(blocked).toMatchObject({ block: true });
    expect(context.ui.confirm).not.toHaveBeenCalled();
    expect(approvals.size).toBe(0);

    await expect(
      guardExecCommand(
        { toolCallId: "mutated", input: { cmd: "echo safe", shell: "bash" } },
        context,
        approvals,
      ),
    ).resolves.toBeUndefined();
    const stop = registerUnifiedExecGuards(approvals);
    try {
      const finalRequest = commandEnvironmentEvent(
        "mutated",
        "invocation",
        INCIDENT,
        directory,
        "bash",
        undefined,
        { ...process.env, HOME: "/home/test-owner" },
      );
      runFinalSpawnPolicies(finalRequest);
      expect(() => {
        throwIfCommandEnvironmentRejected(finalRequest);
      }).toThrow("does not match an approved tool call");
    } finally {
      stop();
    }
  });
});
