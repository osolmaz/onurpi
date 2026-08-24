import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { spawn, type IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const terminals: IPty[] = [];

function waitForOutput(terminal: IPty, output: { value: string }, expected: string): Promise<void> {
  if (output.value.includes(expected)) return Promise.resolve();
  return new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      subscription.dispose();
      reject(
        new Error(
          `Timed out waiting for ${JSON.stringify(expected)}. Output tail: ${JSON.stringify(output.value.slice(-4000))}`,
        ),
      );
    }, 15_000);
    const subscription = terminal.onData((data) => {
      output.value = `${output.value}${data}`.slice(-200_000);
      if (!output.value.includes(expected)) return;
      clearTimeout(timeout);
      subscription.dispose();
      resolvePromise();
    });
  });
}

function waitForExit(terminal: IPty): Promise<number> {
  return new Promise<number>((resolvePromise) => {
    terminal.onExit(({ exitCode }) => {
      resolvePromise(exitCode);
    });
  });
}

function directChildPid(parentPid: number): number {
  const output = execFileSync("ps", ["--ppid", String(parentPid), "-o", "pid="], {
    encoding: "utf8",
  });
  const pids = output.trim().split(/\s+/u).filter(Boolean).map(Number).filter(Number.isSafeInteger);
  if (pids.length !== 1 || pids[0] === undefined) {
    throw new Error(
      `Expected one Pi child for launcher ${String(parentPid)}, got ${output.trim()}.`,
    );
  }
  return pids[0];
}

afterEach(() => {
  for (const terminal of terminals.splice(0)) {
    try {
      terminal.kill();
    } catch {
      // The terminal already exited.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("real Pi restart", () => {
  it.skipIf(process.platform !== "linux")(
    "replaces the Pi worker and reopens the exact session",
    async () => {
      const repoRoot = resolve(import.meta.dirname, "../..");
      const root = mkdtempSync(join(tmpdir(), "onurpi-restart-e2e-"));
      roots.push(root);
      const configDir = join(root, "config");
      const sessionsDir = join(root, "sessions");
      mkdirSync(configDir);
      mkdirSync(sessionsDir);
      writeFileSync(
        join(configDir, "settings.json"),
        `${JSON.stringify({ packages: [join(repoRoot, "packages/restart")] }, null, 2)}\n`,
      );
      const sessionId = "01900000-0000-7000-8000-000000000001";
      const sessionFile = join(sessionsDir, `restart-${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "session",
          version: 3,
          id: sessionId,
          timestamp: "2026-08-24T00:00:00.000Z",
          cwd: root,
        })}\n`,
      );

      const terminal = spawn(
        join(repoRoot, "packages/restart/bin/pi.ts"),
        ["--session-dir", sessionsDir, "--session", sessionFile, "--no-tools", "--offline"],
        {
          cwd: root,
          cols: 120,
          rows: 30,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: configDir,
            PI_OFFLINE: "1",
          },
        },
      );
      terminals.push(terminal);
      const output = { value: "" };
      const initialOutput = terminal.onData((data) => {
        output.value = `${output.value}${data}`.slice(-200_000);
      });
      await waitForOutput(terminal, output, "No models available.");
      initialOutput.dispose();
      const oldWorkerPid = directChildPid(terminal.pid);

      terminal.write("/restart\r");
      await waitForOutput(terminal, output, "Restart complete.");
      const newWorkerPid = directChildPid(terminal.pid);
      expect(newWorkerPid).not.toBe(oldWorkerPid);

      output.value = "";
      terminal.write("/session\r");
      await waitForOutput(terminal, output, sessionId);
      expect(output.value).toContain(sessionFile);
      expect(output.value).toContain(root);

      const exited = waitForExit(terminal);
      terminal.write("\x04");
      await expect(exited).resolves.toBe(0);
      terminals.splice(terminals.indexOf(terminal), 1);
      expect(() => process.kill(terminal.pid, 0)).toThrow();
      expect(() => process.kill(oldWorkerPid, 0)).toThrow();
      expect(() => process.kill(newWorkerPid, 0)).toThrow();
    },
    30_000,
  );
});
