import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { resolveTarget } from "../src/git-target.js";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-git-"));
  cleanup.push(root);
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(path.join(root, "file.ts"), "export const value = 1;\n");
  await exec("git", ["add", "file.ts"], { cwd: root });
  await exec("git", ["commit", "-m", "initial change"], { cwd: root });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  await exec("git", ["switch", "-c", "feature"], { cwd: root });
  await writeFile(path.join(root, "file.ts"), "export const value = 2;\n");
  return { root, head: stdout.trim() };
}

describe("review target resolution", () => {
  it("matches the Codex uncommitted and base prompts", async () => {
    const repo = await repository();
    const uncommitted = await resolveTarget({ kind: "uncommitted" }, repo.root);
    expect(uncommitted.prompt).toBe(
      "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
    );
    const base = await resolveTarget({ kind: "base", branch: "main" }, repo.root);
    expect(base.prompt).toBe(
      `Review the code changes against the base branch 'main'. The merge base commit for this comparison is ${repo.head}. Run \`git diff ${repo.head}\` to inspect the changes relative to main. Provide prioritized, actionable findings.`,
    );
    expect(base.hint).toBe("changes against 'main'");
  });

  it("uses the Codex backup prompt when branches have no merge base", async () => {
    const repo = await repository();
    await exec("git", ["add", "file.ts"], { cwd: repo.root });
    await exec("git", ["commit", "-m", "feature"], { cwd: repo.root });
    await exec("git", ["switch", "--orphan", "unrelated"], { cwd: repo.root });
    await writeFile(path.join(repo.root, "other.ts"), "export {};\n");
    await exec("git", ["add", "other.ts"], { cwd: repo.root });
    await exec("git", ["commit", "-m", "unrelated"], { cwd: repo.root });
    const result = await resolveTarget({ kind: "base", branch: "main" }, repo.root);
    expect(result.prompt).toContain("Start by finding the merge diff");
    expect(result.prompt).toContain("main@{upstream}");
  });

  it("resolves commits and obtains their titles", async () => {
    const repo = await repository();
    const result = await resolveTarget({ kind: "commit", sha: repo.head }, repo.root);
    expect(result.prompt).toBe(
      `Review the code changes introduced by commit ${repo.head} ("initial change"). Provide prioritized, actionable findings.`,
    );
    const supplied = await resolveTarget(
      { kind: "commit", sha: repo.head, title: "Supplied title" },
      repo.root,
    );
    expect(supplied.prompt).toContain('("Supplied title")');
  });

  it("passes custom instructions and rejects invalid targets", async () => {
    const repo = await repository();
    await expect(
      resolveTarget({ kind: "custom", instructions: " review security " }, repo.root),
    ).resolves.toMatchObject({
      prompt: "review security",
      hint: "review security",
    });
    await expect(resolveTarget({ kind: "base", branch: "--help" }, repo.root)).rejects.toThrow();
    await expect(resolveTarget({ kind: "commit", sha: "missing" }, repo.root)).rejects.toThrow();
    await expect(
      resolveTarget({ kind: "commit", sha: "x".repeat(257) }, repo.root),
    ).rejects.toThrow("too long");
  });
});
