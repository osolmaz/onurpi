import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyPowerShell } from "../src/classifier.ts";
import { commandContext } from "../src/contexts.ts";
import { evaluateCommand } from "../src/policy.ts";
import {
  installedPowerShellParser,
  type PowerShellCommand,
  type PowerShellParser,
  type PowerShellRedirect,
} from "../src/powershell-parser.ts";

function command(name: string, args: string[] = []): PowerShellCommand {
  return {
    name,
    source: [name, ...args].join(" "),
    elements: [name, ...args].map((value) => ({
      kind: value.startsWith("-") ? "CommandParameterAst" : "StringConstantExpressionAst",
      text: value,
      ...(value.startsWith("-") ? {} : { value }),
    })),
  };
}

function parser(
  commands: PowerShellCommand[],
  redirects: PowerShellRedirect[] = [],
): PowerShellParser {
  return { parse: vi.fn(() => Promise.resolve({ commands, redirects, errors: [] })) };
}

afterEach(() => vi.restoreAllMocks());

describe("parsed PowerShell commands", () => {
  it.each([
    ["git", ["status", "--short", "--branch"]],
    ["git", ["--no-pager", "log"]],
    ["git", ["-C/repo", "status"]],
    ["git", ["--version"]],
    ["git", ["-C", "/repo", "status", "--short"]],
    ["git", ["-C", "clean", "status", "--short"]],
    ["git", ["log", "--", "clean", "-f"]],
    ["git", ["remote", "-v"]],
    ["git", ["log", "-1", "--oneline"]],
    ["git", ["diff", "--check"]],
    ["git", ["switch", "feature"]],
    ["git", ["reset", "--soft", "HEAD"]],
    ["git.exe", ["status"]],
    ["C:\\Program Files\\Git\\bin\\git.exe", ["status"]],
    ["Write-Output", ["git", "pwsh", "rm"]],
  ])("allows parsed non-destructive %s %s", async (name, args) => {
    const parsed = command(name, args);
    const helper = parser([parsed]);
    const result = await classifyPowerShell(parsed.source, helper);
    expect(result.uncertainReason).toBeUndefined();
    expect(result.operations).toEqual([]);
    expect(helper.parse).toHaveBeenCalledWith(parsed.source);
  });

  it("allows the original read-only preflight when parsing succeeds", async () => {
    const commands = [
      command("Get-Location"),
      command("Get-Item", ["Env:PATH", "-ErrorAction", "SilentlyContinue"]),
      command("Get-ChildItem", ["/repo", "-Filter", "AGENTS.md", "-Force"]),
      command("Select-Object", ["Mode,Name"]),
      command("git", ["-C", "/repo", "status", "--short", "--branch"]),
      command("git", ["-C", "/repo", "remote", "-v"]),
    ];
    const source = commands.map((item) => item.source).join("; ");
    const result = await classifyPowerShell(source, parser(commands));
    expect(result.uncertainReason).toBeUndefined();
    expect(result.operations).toEqual([]);
  });

  it("keeps parser absence and syntax errors blocked", async () => {
    await expect(
      classifyPowerShell("git status", { parse: () => Promise.resolve(undefined) }),
    ).resolves.toMatchObject({ uncertainReason: "official PowerShell parser is unavailable" });
    await expect(
      classifyPowerShell("git 'status", {
        parse: () => Promise.resolve({ commands: [], redirects: [], errors: ["missing quote"] }),
      }),
    ).resolves.toMatchObject({ uncertainReason: "PowerShell syntax contains errors" });
  });

  it.each([
    ["cmd", ["/c", "echo safe"]],
    ["bash", ["-c", "$code"]],
    ["pwsh", ["-File", "script.ps1"]],
    ["command", ["git", "status"]],
    ["sudo", ["git", "status"]],
    ["find", [".", "-exec", "rm", "-rf", "/", ";"]],
  ])("rejects unchecked %s even alongside a recognized deletion", async (name, args) => {
    const launcher = command(name, args);
    const removal = command("Remove-Item", ["file"]);
    for (const commands of [[launcher], [removal, launcher]]) {
      const result = await classifyPowerShell(
        commands.map((item) => item.source).join("; "),
        parser(commands),
      );
      expect(result.uncertainReason).toContain("cannot be checked");
    }
  });

  it.each([
    ["clean", "-fd"],
    ["reset", "--hard", "HEAD"],
    ["switch", "--discard-changes", "branch"],
    ["checkout", "--force", "branch"],
  ])("applies the protected-path policy to native Git: %s", async (...args) => {
    const parsed = command("git", args);
    vi.spyOn(installedPowerShellParser, "parse").mockImplementation(parser([parsed]).parse);
    await expect(
      evaluateCommand(
        commandContext({ command: parsed.source, cwd: process.cwd(), shell: "powershell" }),
      ),
    ).resolves.toMatchObject({ action: "deny" });
  });

  it.each([
    ["-c", "alias.wipe=!rm -rf /", "wipe"],
    ["--config-env=alias.wipe=SCRIPT", "wipe"],
    ["--exec-path=/tmp/tools", "status"],
    ["wipe"],
    ["-C"],
  ])("does not allow unchecked native Git execution: %s", async (...args) => {
    const parsed = command("git", args);
    await expect(classifyPowerShell(parsed.source, parser([parsed]))).resolves.toMatchObject({
      uncertainReason: "PowerShell Git invocation cannot be checked",
    });
  });

  it("classifies parsed storage commands and denies destructive diskutil verbs", async () => {
    const format = command("mkfs.ext4", ["C:\\images\\disk.img"]);
    await expect(classifyPowerShell(format.source, parser([format]))).resolves.toMatchObject({
      operations: [{ kind: "device-write" }],
    });

    const erase = command("diskutil", ["eraseDisk", "APFS", "Empty", "disk2"]);
    await expect(classifyPowerShell(erase.source, parser([erase]))).resolves.toMatchObject({
      denyReason: "diskutil eraseDisk can erase storage",
    });

    const list = command("diskutil", ["list"]);
    await expect(classifyPowerShell(list.source, parser([list]))).resolves.toMatchObject({
      operations: [],
    });
  });

  it("checks every command and redirection after a read-only command", async () => {
    const commands = [command("git", ["status"]), command("Remove-Item", ["/"])];
    const redirects = [
      {
        source: "> /",
        destination: { kind: "StringConstantExpressionAst", text: "/", value: "/" },
      },
    ];
    const result = await classifyPowerShell(
      "git status; Remove-Item / > /",
      parser(commands, redirects),
    );
    expect(result.operations.map((item) => item.kind)).toEqual(["recursive-delete", "truncate"]);
    vi.spyOn(installedPowerShellParser, "parse").mockImplementation(
      parser(commands, redirects).parse,
    );
    await expect(
      evaluateCommand(
        commandContext({
          command: "git status; Remove-Item / > /",
          cwd: process.cwd(),
          shell: "powershell",
        }),
      ),
    ).resolves.toMatchObject({ action: "deny" });
  });

  it("keeps dynamic native arguments and working-directory changes uncertain", async () => {
    const dynamic: PowerShellCommand = {
      ...command("git"),
      elements: [
        { kind: "StringConstantExpressionAst", text: "git", value: "git" },
        { kind: "VariableExpressionAst", text: "$args" },
      ],
    };
    await expect(classifyPowerShell("git $args", parser([dynamic]))).resolves.toMatchObject({
      uncertainReason: "PowerShell Git arguments are not fixed strings",
    });
    const alternate = command("git", ["-C", "clean", "reset", "--hard", "HEAD"]);
    const alternateResult = await classifyPowerShell(alternate.source, parser([alternate]));
    expect(alternateResult.operations[0]?.targets[0]?.reason).toBe(
      "Git uses an alternate working tree",
    );
    const commands = [command("Set-Location", ["child"]), command("git", ["clean", "-fd"])];
    await expect(
      classifyPowerShell("Set-Location child; git clean -fd", parser(commands)),
    ).resolves.toMatchObject({
      uncertainReason: "working directory changes before a destructive command",
    });
  });
});
