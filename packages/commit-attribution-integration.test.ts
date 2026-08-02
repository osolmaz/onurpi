import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { applyCommitAttribution, CommitAttributionSession } from "./pi-must-win/index.ts";
import { runExecCommand } from "./unified-exec/src/exec-command.ts";
import { createRuntimeState } from "./unified-exec/src/runtime.ts";
import { shutdownSessions } from "./unified-exec/src/termination.ts";
import type { ExtensionRuntime } from "./unified-exec/src/tool-types.ts";

const sessions: CommitAttributionSession[] = [];
const directories: string[] = [];
const runtimes: ExtensionRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => shutdownSessions(runtime)));
  for (const session of sessions.splice(0)) session.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function session(): CommitAttributionSession {
  const value = new CommitAttributionSession();
  sessions.push(value);
  return value;
}

it("adds Pi trailers only to commits spawned through Unified Exec", async () => {
  const attributedDirectory = mkdtempSync(join(tmpdir(), "onurpi-must-win-"));
  directories.push(attributedDirectory);
  execFileSync("git", ["init", "-q"], { cwd: attributedDirectory });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: attributedDirectory });
  execFileSync("git", ["config", "user.email", "tester@example.com"], {
    cwd: attributedDirectory,
  });
  writeFileSync(join(attributedDirectory, "file"), "test\n");
  execFileSync("git", ["add", "file"], { cwd: attributedDirectory });
  const attribution = session();
  const runtime = createRuntimeState({
    send: () => undefined,
    prepareEnvironment: (event) => {
      applyCommitAttribution(event, attribution, "0.83.0");
    },
  });
  runtimes.push(runtime);
  const result = await runExecCommand(
    runtime,
    {
      cmd: "git commit -q -m integrated",
      on_exit: "none",
      tty: false,
      yield_time_ms: 30_000,
    },
    undefined,
    undefined,
    attributedDirectory,
    { id: "model-id", name: "Model Name", provider: "provider" },
  );

  expect(result.exit_code).toBe(0);
  const attributedMessage = execFileSync("git", ["log", "-1", "--format=%B"], {
    cwd: attributedDirectory,
    encoding: "utf8",
  });
  expect(attributedMessage).toContain("Co-Authored-By: Model Name <noreply@pi.dev>");
  expect(attributedMessage).toContain("Generated-By: pi 0.83.0 (https://pi.dev)");

  const terminalDirectory = mkdtempSync(join(tmpdir(), "onurpi-terminal-"));
  directories.push(terminalDirectory);
  execFileSync("git", ["init", "-q"], { cwd: terminalDirectory });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: terminalDirectory });
  execFileSync("git", ["config", "user.email", "tester@example.com"], {
    cwd: terminalDirectory,
  });
  writeFileSync(join(terminalDirectory, "file"), "test\n");
  execFileSync("git", ["add", "file"], { cwd: terminalDirectory });
  execFileSync("git", ["commit", "-q", "-m", "terminal"], { cwd: terminalDirectory });
  const message = execFileSync("git", ["log", "-1", "--format=%B"], {
    cwd: terminalDirectory,
    encoding: "utf8",
  });

  expect(message).not.toContain("noreply@pi.dev");
  expect(message).not.toContain("Generated-By: pi");
});
