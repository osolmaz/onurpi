import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CommitAttributionSession } from "pi-must-win/index.ts";
import { runExecCommand } from "../unified-exec/src/exec-command.ts";
import { createRuntimeState } from "../unified-exec/src/runtime.ts";
import { shutdownSessions } from "../unified-exec/src/termination.ts";
import type { ExtensionRuntime } from "../unified-exec/src/tool-types.ts";
import { applyCommitAttribution, isCommandEnvironmentEvent } from "./index.ts";

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

describe("Pi Must Win adapter", () => {
  it("validates and attributes Unified Exec environment events", () => {
    const event = {
      command: "git commit -m test",
      cwd: "/repo",
      shell: "/bin/bash",
      model: { id: "model-id", name: "Model Name", provider: "provider" },
      environment: { KEEP_ME: "yes" },
    };

    expect(isCommandEnvironmentEvent(event)).toBe(true);
    expect(applyCommitAttribution(event, session(), "0.83.0")).toBe(true);
    expect(event.environment).toMatchObject({
      KEEP_ME: "yes",
      PI_MUST_WIN_CO_AUTHOR: "Co-Authored-By: Model Name <noreply@pi.dev>",
      PI_MUST_WIN_GENERATED_BY: "Generated-By: pi 0.83.0 (https://pi.dev)",
    });
  });

  it("rejects malformed event-bus values", () => {
    const attribution = session();
    expect(applyCommitAttribution(undefined, attribution, "0.83.0")).toBe(false);
    expect(
      applyCommitAttribution(
        { command: "git status", cwd: "/repo", shell: "bash", environment: { BAD: 1 } },
        attribution,
        "0.83.0",
      ),
    ).toBe(false);
  });

  it("adds trailers to a commit spawned by Unified Exec", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "onurpi-must-win-"));
    directories.push(cwd);
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.name", "Tester"], { cwd });
    execFileSync("git", ["config", "user.email", "tester@example.com"], { cwd });
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
        cmd: "set -euo pipefail; echo test > file; git add file; git commit -q -m integrated; git log -1 --format=%B",
        on_exit: "none",
        tty: false,
        yield_time_ms: 30_000,
      },
      undefined,
      undefined,
      cwd,
      { id: "model-id", name: "Model Name", provider: "provider" },
    );

    expect(result.output).toContain("Co-Authored-By: Model Name <noreply@pi.dev>");
    expect(result.output).toContain("Generated-By: pi 0.83.0 (https://pi.dev)");
  });

  it("leaves a terminal commit unattributed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "onurpi-terminal-"));
    directories.push(cwd);
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.name", "Tester"], { cwd });
    execFileSync("git", ["config", "user.email", "tester@example.com"], { cwd });
    execFileSync("bash", ["-lc", "echo test > file; git add file; git commit -q -m terminal"], {
      cwd,
    });
    const message = execFileSync("git", ["log", "-1", "--format=%B"], {
      cwd,
      encoding: "utf8",
    });

    expect(message).not.toContain("noreply@pi.dev");
    expect(message).not.toContain("Generated-By: pi");
  });
});
