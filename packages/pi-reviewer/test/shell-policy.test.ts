import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  containsPath,
  executeShellCommand,
  safeEnvironment,
  safeProgramArgs,
  validateCheckoutPath,
  validateShellCommand,
} from "../extensions/shell-policy.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function roots(): Promise<{ root: string; outside: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-shell-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-outside-"));
  cleanup.push(root, outside);
  await writeFile(path.join(root, "file.txt"), "hello\n");
  await writeFile(path.join(outside, "secret.txt"), "secret\n");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "escape"));
  return { root, outside };
}

describe("read-only shell policy", () => {
  it("allows direct repository inspection commands", async () => {
    const { root } = await roots();
    await expect(validateShellCommand("git diff -- file.txt", root)).resolves.toEqual({
      program: "git",
      args: ["diff", "--", "file.txt"],
    });
    await expect(validateShellCommand("rg 'hello world|goodbye' .", root)).resolves.toEqual({
      program: "rg",
      args: ["hello world|goodbye", "."],
    });
    const command = await validateShellCommand("cat file.txt", root);
    await expect(executeShellCommand(command, root)).resolves.toMatchObject({
      output: "hello\n",
      exitCode: 0,
      truncated: false,
    });
  });

  it("rejects mutation, shell syntax, helpers, and network clients", async () => {
    const { root } = await roots();
    await expect(validateShellCommand("git add file.txt", root)).rejects.toThrow("subcommand");
    await expect(validateShellCommand("git diff --ext-diff", root)).rejects.toThrow(
      "external helpers",
    );
    await expect(validateShellCommand("git diff --output=victim", root)).rejects.toThrow(
      "output files",
    );
    await expect(validateShellCommand("git diff --output escape", root)).rejects.toThrow(
      "output files",
    );
    await expect(validateShellCommand("find . -exec rm file.txt ;", root)).rejects.toThrow();
    await expect(validateShellCommand("find . -delete", root)).rejects.toThrow("unavailable");
    await expect(validateShellCommand("find . -fprint0 review-output", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(validateShellCommand("find -files0-from roots", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(validateShellCommand("rg --pre cat pattern .", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(validateShellCommand("rg --config-path config pattern .", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(validateShellCommand("rg --follow pattern .", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(
      validateShellCommand("rg --ignore-file=/etc/passwd pattern .", root),
    ).rejects.toThrow("outside");
    await expect(validateShellCommand("grep -R pattern .", root)).rejects.toThrow("unavailable");
    await expect(validateShellCommand("wc --files0-from names", root)).rejects.toThrow(
      "unavailable",
    );
    await expect(validateShellCommand("curl https://example.com", root)).rejects.toThrow(
      "allowlist",
    );
    await expect(validateShellCommand("cat file.txt | wc", root)).rejects.toThrow("operators");
    await expect(validateShellCommand("cat $(pwd)", root)).rejects.toThrow("operators");
    await expect(validateShellCommand("X=1 git status", root)).rejects.toThrow(
      "environment assignments",
    );
    await expect(validateShellCommand("cat 'unterminated", root)).rejects.toThrow("unterminated");
    await expect(validateShellCommand("", root)).rejects.toThrow("length");
    await expect(validateShellCommand("x".repeat(16_385), root)).rejects.toThrow("length");
    await expect(validateShellCommand("git", root)).rejects.toThrow("subcommand");
    await expect(validateShellCommand("cat file.txt\nwc file.txt", root)).rejects.toThrow(
      "multiline",
    );
  });

  it("forces ripgrep to ignore configuration", () => {
    expect(safeProgramArgs("rg", ["needle", "."])).toEqual(["--no-config", "needle", "."]);
  });

  it("removes model credentials from command environments", () => {
    const environment = safeEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/reviewer",
      HF_TOKEN: "secret",
      OPENAI_API_KEY: "secret",
      RIPGREP_CONFIG_PATH: "/tmp/unsafe",
    });
    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/reviewer",
      GIT_EXTERNAL_DIFF: "",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    });
    expect(environment).not.toHaveProperty("HF_TOKEN");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("RIPGREP_CONFIG_PATH");
  });

  it("bounds output and supports cancellation", async () => {
    const { root } = await roots();
    await writeFile(path.join(root, "large.txt"), "x".repeat(140 * 1024));
    const large = await executeShellCommand(
      await validateShellCommand("cat large.txt", root),
      root,
    );
    expect(large.truncated).toBe(true);
    expect(large.output).toContain("output truncated");

    const controller = new AbortController();
    const pending = executeShellCommand(
      { program: process.execPath, args: ["-e", "setInterval(() => {}, 1_000)"] },
      root,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 20);
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("rejects lexical, cross-drive, and symlink escapes", async () => {
    const { root, outside } = await roots();
    expect(containsPath("C:\\repo", "D:\\secret.txt", path.win32)).toBe(false);
    expect(containsPath("C:\\repo", "C:\\repo\\src\\file.ts", path.win32)).toBe(true);
    await expect(validateCheckoutPath("../outside", root)).rejects.toThrow("outside");
    await expect(validateCheckoutPath(path.join(outside, "secret.txt"), root)).rejects.toThrow(
      "outside",
    );
    await expect(validateCheckoutPath("escape", root)).rejects.toThrow("symlinks outside");
    await expect(validateShellCommand("cat escape", root)).rejects.toThrow("symlinks outside");
  });
});
