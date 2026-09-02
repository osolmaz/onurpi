import { spawn } from "node:child_process";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const PARSE_TIMEOUT_MS = 3000;

const PARSER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = [Console]::In.ReadToEnd()
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
function Convert-Element($node) {
  $value = $null
  if ($node -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
    $value = $node.Value
  } elseif ($node -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $node.NestedExpressions.Count -eq 0) {
    $value = $node.Value
  }
  [pscustomobject]@{
    kind = $node.GetType().Name
    text = $node.Extent.Text
    value = $value
  }
}
$commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
  [pscustomobject]@{
    name = $_.GetCommandName()
    source = $_.Extent.Text
    elements = @($_.CommandElements | ForEach-Object { Convert-Element $_ })
  }
})
$redirects = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FileRedirectionAst] }, $true) | Where-Object { -not $_.Append } | ForEach-Object {
  [pscustomobject]@{
    source = $_.Extent.Text
    destination = Convert-Element $_.Location
  }
})
[pscustomobject]@{
  errors = @($errors | ForEach-Object { $_.Message })
  commands = $commands
  redirects = $redirects
} | ConvertTo-Json -Depth 8 -Compress
`;

export type PowerShellElement = Readonly<{
  kind: string;
  text: string;
  value?: string;
}>;

export type PowerShellCommand = Readonly<{
  name?: string;
  source: string;
  elements: readonly PowerShellElement[];
}>;

export type PowerShellRedirect = Readonly<{
  source: string;
  destination: PowerShellElement;
}>;

export type PowerShellParseResult = Readonly<{
  commands: readonly PowerShellCommand[];
  errors: readonly string[];
  redirects: readonly PowerShellRedirect[];
}>;

export type PowerShellParser = Readonly<{
  parse(source: string): Promise<PowerShellParseResult | undefined>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function element(value: unknown): PowerShellElement | undefined {
  if (!isRecord(value) || typeof value["kind"] !== "string" || typeof value["text"] !== "string") {
    return undefined;
  }
  if (
    value["value"] !== null &&
    value["value"] !== undefined &&
    typeof value["value"] !== "string"
  ) {
    return undefined;
  }
  return {
    kind: value["kind"],
    text: value["text"],
    ...(typeof value["value"] === "string" ? { value: value["value"] } : {}),
  };
}

// eslint-disable-next-line complexity -- Strictly validate every optional parser field before use.
function command(value: unknown): PowerShellCommand | undefined {
  if (
    !isRecord(value) ||
    typeof value["source"] !== "string" ||
    !Array.isArray(value["elements"])
  ) {
    return undefined;
  }
  if (value["name"] !== null && value["name"] !== undefined && typeof value["name"] !== "string") {
    return undefined;
  }
  const elements = value["elements"].map(element);
  if (elements.some((item) => item === undefined)) return undefined;
  return {
    source: value["source"],
    elements: elements.filter((item): item is PowerShellElement => item !== undefined),
    ...(typeof value["name"] === "string" ? { name: value["name"] } : {}),
  };
}

function redirect(value: unknown): PowerShellRedirect | undefined {
  if (!isRecord(value) || typeof value["source"] !== "string") return undefined;
  const destination = element(value["destination"]);
  return destination ? { source: value["source"], destination } : undefined;
}

export function decodePowerShellParseResult(text: string): PowerShellParseResult {
  const value: unknown = JSON.parse(text);
  if (
    !isRecord(value) ||
    !Array.isArray(value["commands"]) ||
    !Array.isArray(value["errors"]) ||
    !Array.isArray(value["redirects"]) ||
    value["errors"].some((item) => typeof item !== "string")
  ) {
    throw new Error("PowerShell parser returned an invalid result");
  }
  const commands = value["commands"].map(command);
  const redirects = value["redirects"].map(redirect);
  if (commands.some((item) => item === undefined) || redirects.some((item) => item === undefined)) {
    throw new Error("PowerShell parser returned invalid syntax nodes");
  }
  return {
    commands: commands.filter((item): item is PowerShellCommand => item !== undefined),
    errors: value["errors"].filter((item): item is string => typeof item === "string"),
    redirects: redirects.filter((item): item is PowerShellRedirect => item !== undefined),
  };
}

type RunResult = Readonly<{ found: boolean; output?: string }>;

function runParser(executable: string, source: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PARSER_SCRIPT],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell parser timed out"));
    }, PARSE_TIMEOUT_MS);
    const append = (chunks: Buffer[], chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("PowerShell parser output exceeds safety limit"));
        return;
      }
      chunks.push(chunk);
    };
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      append(output, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      append(errors, chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") resolve({ found: false });
      else reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ found: true, output: Buffer.concat(output).toString("utf8") });
      else reject(new Error(`PowerShell parser failed: ${Buffer.concat(errors).toString("utf8")}`));
    });
    child.stdin.end(source);
  });
}

const executableNames =
  process.platform === "win32"
    ? [
        join(
          process.env["SystemRoot"] ?? process.env["WINDIR"] ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
      ]
    : ["pwsh"];

async function parseWithInstalledPowerShell(
  source: string,
): Promise<PowerShellParseResult | undefined> {
  for (const executable of executableNames) {
    const result = await runParser(executable, source);
    if (!result.found) continue;
    if (!result.output) throw new Error("PowerShell parser returned no output");
    return decodePowerShellParseResult(result.output);
  }
  return undefined;
}

export function createPowerShellParser(executable: string): PowerShellParser {
  return {
    async parse(source) {
      const result = await runParser(executable, source);
      if (!result.found) return undefined;
      if (!result.output) throw new Error("PowerShell parser returned no output");
      return decodePowerShellParseResult(result.output);
    },
  };
}

export const installedPowerShellParser: PowerShellParser = {
  parse: parseWithInstalledPowerShell,
};
