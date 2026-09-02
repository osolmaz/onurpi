import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { commandFingerprint, ExecutionCheckStore } from "../src/execution-check.ts";
import { commandContext } from "../src/contexts.ts";
import { parseLinuxMountRoots, resolveTargets, verifyTargets } from "../src/path-policy.ts";
import { evaluateCommand } from "../src/policy.ts";
import type { DestructiveOperation, ResolvedWord } from "../src/types.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-path-"));
  mkdirSync(join(directory, "child"));
  writeFileSync(join(directory, "child", "file"), "data");
  symlinkSync(join(directory, "child", "file"), join(directory, "link"));
  symlinkSync(join(directory, "missing"), join(directory, "dangling"));
});

function word(value: string): ResolvedWord {
  return { raw: value, value, referencedVariables: [] };
}

function deletion(target: string): DestructiveOperation {
  return { command: "rm", kind: "delete", source: `rm ${target}`, targets: [word(target)] };
}

describe("target resolution", () => {
  it("parses escaped Linux mount roots, including bind mounts", () => {
    const roots = parseLinuxMountRoots(
      "36 25 0:32 / / rw,relatime - overlay overlay rw\n" +
        "37 36 0:33 / /work\\040tree rw,relatime - tmpfs tmpfs rw\n",
    );
    expect(roots.has("/")).toBe(true);
    expect(roots.has("/work tree")).toBe(true);
    expect(() => parseLinuxMountRoots("invalid")).toThrow("invalid Linux mount table entry");
  });

  it("canonicalizes existing, symlinked, and missing targets", async () => {
    const existing = await resolveTargets([deletion("child/file")], directory);
    expect(existing).toMatchObject({ ok: true });
    if (!existing.ok) throw new Error(existing.reason);
    expect(existing.targets[0]).toMatchObject({
      canonicalPath: join(directory, "child", "file"),
      operandPath: join(directory, "child", "file"),
      existed: true,
    });
    expect(verifyTargets(existing.targets)).toBe(true);

    const linked = await resolveTargets([deletion("link")], directory);
    expect(linked).toMatchObject({ ok: true });
    if (!linked.ok) throw new Error(linked.reason);
    expect(linked.targets[0]?.canonicalPath).toBe(join(directory, "child", "file"));
    expect(linked.targets[0]?.operandPath).toBe(join(directory, "link"));
    expect(verifyTargets(linked.targets)).toBe(true);

    const missing = await resolveTargets([deletion("child/missing/deep")], directory);
    expect(missing).toMatchObject({ ok: true });
    if (!missing.ok) throw new Error(missing.reason);
    expect(missing.targets[0]).toMatchObject({
      canonicalPath: join(directory, "child", "missing", "deep"),
      existed: false,
    });
    expect(verifyTargets(missing.targets)).toBe(true);
  });

  it("fails closed for dangling symlink targets", async () => {
    await expect(resolveTargets([deletion("dangling")], directory)).rejects.toThrow(
      "cannot resolve dangling symlink target",
    );
  });

  it("denies roots and rejects inexact or empty targets", async () => {
    await expect(resolveTargets([deletion(".")], directory)).resolves.toMatchObject({
      ok: false,
      action: "deny",
    });
    await expect(resolveTargets([deletion("")], directory)).resolves.toMatchObject({
      ok: false,
      action: "deny",
    });
    await expect(
      resolveTargets(
        [
          {
            ...deletion("unknown"),
            targets: [{ raw: "$UNKNOWN", referencedVariables: [], reason: "unknown" }],
          },
        ],
        directory,
      ),
    ).resolves.toMatchObject({ ok: false, action: "rewrite" });
    await expect(
      resolveTargets([{ ...deletion("none"), targets: [] }], directory),
    ).resolves.toMatchObject({ ok: false, action: "rewrite" });
  });

  it("detects a dangling symlink that appears at a checked missing path", async () => {
    const resolution = await resolveTargets([deletion("appears")], directory);
    if (!resolution.ok) throw new Error(resolution.reason);
    symlinkSync(join(directory, "still-missing"), join(directory, "appears"));
    expect(verifyTargets(resolution.targets)).toBe(false);
  });

  it("detects object replacement", async () => {
    const path = join(directory, "replace-me");
    writeFileSync(path, "first");
    const resolution = await resolveTargets([deletion(path)], directory);
    if (!resolution.ok) throw new Error(resolution.reason);
    renameSync(path, `${path}.old`);
    writeFileSync(path, "second");
    expect(verifyTargets(resolution.targets)).toBe(false);
  });
});

describe("one-use final execution check", () => {
  it("binds command, shell, cwd, environment, targets, and expiry", async () => {
    const environment: NodeJS.ProcessEnv = { ...process.env, TARGET: "child/file" };
    const context = commandContext({
      command: 'rm -f "$TARGET"',
      cwd: directory,
      environment,
      shell: "bash",
    });
    const decision = await evaluateCommand(context);
    if (decision.action !== "allow") throw new Error("expected allow");

    let now = 100;
    const checks = new ExecutionCheckStore(() => now);
    checks.remember("one", context, decision);
    expect(checks.size).toBe(1);
    expect(checks.consume("one", context)).toBe(true);
    expect(checks.consume("one", context)).toBe(false);

    checks.remember("environment", context, decision);
    const changedEnvironment = commandContext({
      ...context,
      environment: { ...environment, TARGET: "child/other" },
    });
    expect(checks.consume("environment", changedEnvironment)).toBe(false);

    checks.remember("command", context, decision);
    expect(checks.consume("command", { ...context, command: "rm -f child/other" })).toBe(false);

    checks.remember("shell", context, decision);
    expect(checks.consume("shell", { ...context, shell: "/bin/bash" })).toBe(false);

    checks.remember("security-environment", context, decision);
    expect(
      checks.consume("security-environment", {
        ...context,
        environment: { ...environment, BASH_ENV: "/tmp/startup" },
      }),
    ).toBe(false);

    const { GIT_CONFIG_COUNT: gitConfigCount } = environment;
    const gitConfigIndex = Number(gitConfigCount ?? "0");
    checks.remember("commit-hook", context, decision);
    expect(
      checks.consume("commit-hook", {
        ...context,
        environment: {
          ...environment,
          [`GIT_CONFIG_KEY_${String(gitConfigIndex)}`]: "core.hooksPath",
          [`GIT_CONFIG_VALUE_${String(gitConfigIndex)}`]: "/tmp/reviewed-hooks",
          GIT_CONFIG_COUNT: String(gitConfigIndex + 1),
        },
      }),
    ).toBe(true);

    checks.remember("git-worktree", context, decision);
    expect(
      checks.consume("git-worktree", {
        ...context,
        environment: {
          ...environment,
          [`GIT_CONFIG_KEY_${String(gitConfigIndex)}`]: "core.worktree",
          [`GIT_CONFIG_VALUE_${String(gitConfigIndex)}`]: "/tmp/other-worktree",
          GIT_CONFIG_COUNT: String(gitConfigIndex + 1),
        },
      }),
    ).toBe(false);

    checks.remember("expired", context, decision);
    now += 60_001;
    expect(checks.consume("expired", context)).toBe(false);
    expect(checks.size).toBe(0);
  });

  it("binds variables used in nested command text", async () => {
    const environment = { ...process.env, SCRIPT: "rm -f child/file" };
    const context = commandContext({
      command: 'bash -c "$SCRIPT"',
      cwd: directory,
      environment,
      shell: "bash",
    });
    const decision = await evaluateCommand(context);
    if (decision.action !== "allow") throw new Error("expected allow");
    expect(decision.referencedEnvironment).toMatchObject({ SCRIPT: "rm -f child/file" });
    const checks = new ExecutionCheckStore();
    checks.remember("nested", context, decision);
    expect(
      checks.consume("nested", {
        ...context,
        environment: { ...environment, SCRIPT: "rm -rf ." },
      }),
    ).toBe(false);
  });

  it("does not remember blocked decisions and can clear records", () => {
    const context = commandContext({ command: "echo safe", cwd: directory, shell: "bash" });
    const checks = new ExecutionCheckStore();
    checks.remember("blocked", context, { action: "deny", reason: "no" });
    expect(checks.size).toBe(0);
    checks.remember("allowed", context, {
      action: "allow",
      operations: [],
      referencedEnvironment: {},
      targets: [],
    });
    checks.discard("missing");
    expect(checks.size).toBe(1);
    checks.clear();
    expect(checks.size).toBe(0);
    expect(commandFingerprint(context, [], [])).toHaveLength(64);
  });
});
