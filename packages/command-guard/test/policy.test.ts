import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getBashParser } from "../src/bash-parser.ts";
import { classifyBash, classifyNonBash, classifyPowerShell } from "../src/classifier.ts";
import type { PowerShellParseResult, PowerShellParser } from "../src/powershell-parser.ts";
import { commandContext } from "../src/contexts.ts";
import { MAX_COMMAND_BYTES } from "../src/limits.ts";
import { evaluateCommand } from "../src/policy.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-policy-"));
  writeFileSync(join(directory, "file.txt"), "data");
});

function bash(command: string, environment: NodeJS.ProcessEnv = process.env) {
  return evaluateCommand(commandContext({ command, cwd: directory, environment, shell: "bash" }));
}

describe("Bash policy", () => {
  it("allows commands with no covered destructive operation", async () => {
    await expect(bash("printf '%s\\n' safe")).resolves.toMatchObject({ action: "allow" });
    await expect(bash("git status --short")).resolves.toMatchObject({ action: "allow" });
    await expect(bash("printf 'rm -rf / is text\\n'")).resolves.toMatchObject({ action: "allow" });
  });

  it("allows an exact non-critical deletion without a gate", async () => {
    const decision = await bash("rm -f file.txt");
    expect(decision).toMatchObject({ action: "allow" });
    if (decision.action !== "allow") throw new Error("expected allow");
    expect(decision.operations[0]).toMatchObject({ command: "rm", kind: "delete" });
    expect(decision.targets[0]?.canonicalPath).toBe(join(directory, "file.txt"));
  });

  it("blocks the HOME reassignment incident", async () => {
    const environment = { ...process.env, HOME: process.env["HOME"] };
    const decision = await bash('HOME=$(mktemp -d) true; rm -rf "$HOME"', environment);
    expect(decision).toEqual({
      action: "rewrite",
      reason: "variable HOME is assigned in the script",
    });
  });

  it("blocks other uncertain expansions", async () => {
    await expect(bash("rm -rf *.tmp")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("TARGET='a b'; rm -rf $TARGET")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("PATH=/tmp rm -f file.txt")).resolves.toMatchObject({ action: "rewrite" });
    await expect(
      bash("TARGET=/ sh -c 'rm -rf \"$TARGET\"'", { ...process.env, TARGET: "file.txt" }),
    ).resolves.toMatchObject({ action: "rewrite" });
    await expect(
      bash("env TARGET=/ sh -c 'rm -rf \"$TARGET\"'", { ...process.env, TARGET: "file.txt" }),
    ).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("rm -rf $(printf target)")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("r\\\nm -rf child")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash('"$COMMAND" target')).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("eval 'rm -rf target'")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("bash script.sh")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("git -C child clean -fd")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("rsync --delete source/ host:/target")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(
      bash("rsync --delete source/ child/ --unknown-value /tmp/other"),
    ).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("rsync --delete -Q source/ child/")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash('rsync --delete "$UNKNOWN" source/ child/')).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("cd child; rm -f file")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("command cd child; rm -f file")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("builtin cd child; rm -f file")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("nice rm -f file.txt")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("env -C child rm -f file")).resolves.toMatchObject({ action: "rewrite" });
    await expect(bash("sudo --chdir=child rm -f file")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("alias wipe='rm -rf child'; wipe")).resolves.toMatchObject({
      action: "rewrite",
    });
  });

  it("blocks shell startup code and exported functions", async () => {
    await expect(bash("echo safe", { ...process.env, BASH_ENV: "/tmp/startup" })).resolves.toEqual({
      action: "rewrite",
      reason: "BASH_ENV can run hidden shell code",
    });
    await expect(
      bash("echo safe", { ...process.env, "BASH_FUNC_rm%%": "() { true; }" }),
    ).resolves.toMatchObject({ action: "rewrite" });
    await expect(
      bash("echo safe", { ...process.env, LD_PRELOAD: "/tmp/injected.so" }),
    ).resolves.toMatchObject({ action: "rewrite" });
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    await expect(
      bash("echo safe", { ...process.env, ld_preload: "/tmp/injected.so" }),
    ).resolves.toMatchObject({ action: "rewrite" });
    platform.mockRestore();
    await expect(bash("echo safe", { ...process.env, PATH: ".:/usr/bin" })).resolves.toEqual({
      action: "rewrite",
      reason: "PATH contains a relative executable directory",
    });
    await expect(
      evaluateCommand(commandContext({ command: "echo safe", cwd: directory, shell: "zsh" })),
    ).resolves.toMatchObject({ action: "rewrite" });
  });

  it("blocks critical roots", async () => {
    await expect(bash("rm -rf /")).resolves.toMatchObject({ action: "deny" });
    await expect(bash("rm -rf .")).resolves.toMatchObject({ action: "deny" });
    await expect(bash("git checkout other-branch")).resolves.toMatchObject({ action: "deny" });
    if (process.env["HOME"]) {
      await expect(bash('rm -rf "$HOME"')).resolves.toMatchObject({ action: "deny" });
    }
  });
});

describe("Bash command classifiers", () => {
  it("recognizes wrappers and nested command forms", async () => {
    const parser = await getBashParser();
    const cases = [
      "command rm -f file.txt",
      "env -u HOME rm -f file.txt",
      "env --unset=HOME rm -f file.txt",
      "sudo -u root rm -f file.txt",
      "sudo -uroot rm -f file.txt",
      "busybox rm -f file.txt",
      "xargs -n 1 rm -f file.txt",
      "xargs --max-args=1 rm -f file.txt",
      "xargs -n1 rm -f file.txt",
      "find . -exec rm -f file.txt ';'",
      "sh -c 'rm -f file.txt'",
      "trap 'rm -f file.txt' EXIT",
      "trap -- 'rm -f file.txt' EXIT",
      "exec -a cleanup sh -c 'rm -f file.txt'",
    ];
    for (const source of cases) {
      const result = await classifyBash(source, process.env, parser);
      expect(result.operations.length, source).toBeGreaterThan(0);
    }
  });

  it("recognizes each covered destructive family", async () => {
    const parser = await getBashParser();
    const cases = [
      "unlink file.txt",
      "rmdir child",
      "shred file.txt",
      "find child -delete",
      "rsync -a --delete source/ child/",
      "rsync -e ssh --delete source/ child/",
      "rsync -essh --delete source/ child/",
      "rsync --delete -- source/ child/",
      "rsync --delete source/ child/ --exclude pattern",
      "git clean -fd",
      "git reset --hard HEAD",
      "git restore -- file.txt",
      "git checkout -- file.txt",
      "git switch other-branch",
      "truncate -s 0 file.txt",
      "dd if=/dev/null of=file.txt",
      ": > file.txt",
      "rm --recursive child",
      "rm -R child",
    ];
    for (const source of cases) {
      const result = await classifyBash(source, process.env, parser);
      expect(result.operations.length, source).toBeGreaterThan(0);
    }
  });

  it("allows non-destructive variants and blocks unsafe launchers", async () => {
    const parser = await getBashParser();
    for (const source of [
      "find child -print",
      "rsync -a source/ child/",
      "git clean -n",
      "git reset --soft HEAD",
      "dd if=/dev/null",
    ]) {
      await expect(classifyBash(source, process.env, parser), source).resolves.toMatchObject({
        operations: [],
      });
    }
    for (const source of [
      "cmd /c 'del child'",
      "env -S 'rm -rf child'",
      "fish -c 'rm -rf child'",
      "powershell -Command 'Remove-Item child'",
      "source script.sh",
    ]) {
      const result = await classifyBash(source, process.env, parser);
      expect(result.uncertainReason, source).toBeDefined();
    }
  });

  it("enforces command size and syntax limits", async () => {
    const parser = await getBashParser();
    const oversized = "x".repeat(MAX_COMMAND_BYTES + 1);
    expect(() => parser.parse(oversized, process.env)).toThrow("command text exceeds safety limit");
    await expect(bash(oversized)).resolves.toEqual({
      action: "deny",
      reason: "command text exceeds safety limit",
    });
    await expect(bash("rm -rf 'unterminated")).resolves.toMatchObject({ action: "rewrite" });
  });
});

describe("shell routing", () => {
  it("blocks commands when the selected shell is unsupported", async () => {
    await expect(
      evaluateCommand(commandContext({ command: "echo safe", cwd: directory, shell: "fish" })),
    ).resolves.toMatchObject({ action: "rewrite" });
    await expect(
      evaluateCommand(commandContext({ command: "r\\m target", cwd: directory, shell: "fish" })),
    ).resolves.toMatchObject({ action: "rewrite" });
  });
});

function powerShellParser(result: PowerShellParseResult | undefined): PowerShellParser {
  return { parse: () => Promise.resolve(result) };
}

describe("non-Bash classification", () => {
  it("classifies direct PowerShell and cmd deletion forms", async () => {
    const parsed: PowerShellParseResult = {
      errors: [],
      redirects: [],
      commands: [
        {
          name: "Remove-Item",
          source: "Remove-Item -Recurse target",
          elements: [
            { kind: "StringConstantExpressionAst", text: "Remove-Item", value: "Remove-Item" },
            { kind: "CommandParameterAst", text: "-Recurse" },
            { kind: "StringConstantExpressionAst", text: "target", value: "target" },
          ],
        },
      ],
    };
    await expect(
      classifyPowerShell("Remove-Item -Recurse target", powerShellParser(parsed)),
    ).resolves.toMatchObject({ operations: [{ command: "Remove-Item" }] });
    expect(classifyNonBash("del /q target", "cmd").operations[0]?.targets).toMatchObject([
      { value: "target" },
    ]);
    expect(classifyNonBash('del /q "C:\\work\\file"', "cmd").operations[0]?.targets).toMatchObject([
      { value: "C:\\work\\file" },
    ]);
    expect(classifyNonBash("echo safe", "cmd").operations).toHaveLength(0);
    expect(classifyNonBash("", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash("echo $TARGET", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash("echo rm", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash("type nul > file", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash("del %TARGET%", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash("echo %COMMAND%", "cmd").uncertainReason).toBeDefined();
    expect(classifyNonBash('d"el" target', "cmd").operations).toHaveLength(1);
    expect(classifyNonBash("del target^ name", "cmd").uncertainReason).toBeDefined();
  });

  it("blocks uncertain PowerShell parsing", async () => {
    await expect(
      classifyPowerShell("Remove-Item target", powerShellParser(undefined)),
    ).resolves.toMatchObject({ uncertainReason: "official PowerShell parser is unavailable" });
    await expect(
      classifyPowerShell(
        "Remove-Item 'target",
        powerShellParser({ commands: [], redirects: [], errors: ["unterminated string"] }),
      ),
    ).resolves.toMatchObject({ uncertainReason: "PowerShell syntax contains errors" });
    const dynamic = await classifyPowerShell(
      "Remove-Item $target",
      powerShellParser({
        errors: [],
        redirects: [],
        commands: [
          {
            source: "Remove-Item $target",
            elements: [{ kind: "VariableExpressionAst", text: "$target" }],
          },
        ],
      }),
    );
    expect(dynamic.uncertainReason).toBeDefined();
    const uncertainTarget = await classifyPowerShell(
      "Remove-Item $target",
      powerShellParser({
        errors: [],
        redirects: [],
        commands: [
          {
            name: "Remove-Item",
            source: "Remove-Item $target",
            elements: [
              { kind: "StringConstantExpressionAst", text: "Remove-Item", value: "Remove-Item" },
              { kind: "VariableExpressionAst", text: "$target" },
            ],
          },
        ],
      }),
    );
    expect(uncertainTarget.uncertainReason).toBeDefined();
    await expect(
      classifyPowerShell(
        "cmd /c echo safe",
        powerShellParser({ errors: [], redirects: [], commands: [] }),
      ),
    ).resolves.toMatchObject({
      uncertainReason: "PowerShell command or target is not a fixed string",
    });
    await expect(
      classifyPowerShell(
        "& $command target",
        powerShellParser({
          errors: [],
          redirects: [],
          commands: [],
        }),
      ),
    ).resolves.toMatchObject({ uncertainReason: "dynamic PowerShell command cannot be checked" });
  });
});
