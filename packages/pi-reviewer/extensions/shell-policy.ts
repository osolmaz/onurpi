import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

const ALLOWED_COMMANDS = new Set([
  "git",
  "rg",
  "grep",
  "find",
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
]);
const ALLOWED_GIT_COMMANDS = new Set([
  "status",
  "diff",
  "show",
  "log",
  "blame",
  "merge-base",
  "rev-parse",
  "ls-files",
  "diff-tree",
  "name-rev",
]);
const BLOCKED_GIT_OPTIONS = ["--ext-diff", "--textconv", "--exec-path", "--output"];
const MAX_OUTPUT_BYTES = 128 * 1024;

export type ShellCommand = {
  readonly program: string;
  readonly args: readonly string[];
};

export type ShellResult = {
  readonly output: string;
  readonly exitCode: number;
  readonly truncated: boolean;
};

export async function validateShellCommand(command: string, cwd: string): Promise<ShellCommand> {
  if (command.length === 0 || command.length > 16_384) throw new Error("command length is invalid");
  const argv = tokenize(command);
  const [program, ...args] = argv;
  if (program === undefined || !ALLOWED_COMMANDS.has(program)) {
    throw new Error("command is not in the read-only allowlist");
  }
  validateProgramArgs(program, args);
  await validatePaths(argv.slice(1), cwd);
  return { program, args };
}

export async function executeShellCommand(
  command: ShellCommand,
  cwd: string,
  signal?: AbortSignal,
): Promise<ShellResult> {
  const args = command.program === "git" ? safeGitArgs(command.args) : command.args;
  return await new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(command.program, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: safeEnvironment(),
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (chunk: Buffer): void => {
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code, terminationSignal) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted === true) reject(new Error("command cancelled"));
      else if (terminationSignal !== null)
        reject(new Error(`command terminated by ${terminationSignal}`));
      else {
        const suffix = truncated ? `\n[output truncated at ${String(MAX_OUTPUT_BYTES)} bytes]` : "";
        resolve({
          output: `${Buffer.concat(chunks).toString("utf8")}${suffix}`,
          exitCode: code ?? 1,
          truncated,
        });
      }
    });
  });
}

type TokenState = {
  token: string;
  quote: "single" | "double" | undefined;
  escaped: boolean;
};

function tokenize(command: string): readonly string[] {
  assertSingleLine(command);
  const tokens: string[] = [];
  const state: TokenState = { token: "", quote: undefined, escaped: false };
  for (const char of command) {
    if (consumeTokenChar(state, char)) pushToken(tokens, state);
  }
  assertCompleteToken(state);
  pushToken(tokens, state);
  validateTokens(tokens);
  return tokens;
}

function assertSingleLine(command: string): void {
  if (["\n", "\r", "\0"].some((char) => command.includes(char))) {
    throw new Error("multiline commands are not allowed");
  }
}

function assertCompleteToken(state: TokenState): void {
  if (state.escaped || state.quote !== undefined) throw new Error("unterminated shell quoting");
}

function validateTokens(tokens: readonly string[]): void {
  if (tokens.length === 0) throw new Error("command is empty");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[0] ?? "")) {
    throw new Error("environment assignments are not allowed");
  }
}

function consumeTokenChar(state: TokenState, char: string): boolean {
  if (state.escaped) {
    state.token += char;
    state.escaped = false;
    return false;
  }
  if (isEscapingBackslash(char, state.quote)) {
    state.escaped = true;
    return false;
  }
  if (isQuoteForState(char, state.quote)) {
    state.quote = nextQuote(char, state.quote);
    return false;
  }
  if (isUnquotedWhitespace(char, state.quote)) return true;
  if (isUnquotedOperator(char, state.quote)) throw new Error("shell operators are not allowed");
  state.token += char;
  return false;
}

function isEscapingBackslash(char: string, quote: TokenState["quote"]): boolean {
  return char === "\\" && quote !== "single";
}

function isQuoteForState(char: string, quote: TokenState["quote"]): boolean {
  return (char === "'" && quote !== "double") || (char === '"' && quote !== "single");
}

function isUnquotedWhitespace(char: string, quote: TokenState["quote"]): boolean {
  return quote === undefined && /\s/u.test(char);
}

function isUnquotedOperator(char: string, quote: TokenState["quote"]): boolean {
  return quote === undefined && "|&;<>`$".includes(char);
}

function nextQuote(char: string, quote: TokenState["quote"]): TokenState["quote"] {
  if (quote !== undefined) return undefined;
  return char === "'" ? "single" : "double";
}

function pushToken(tokens: string[], state: TokenState): void {
  if (state.token !== "") tokens.push(state.token);
  state.token = "";
}

function validateProgramArgs(program: string, args: readonly string[]): void {
  if (program === "git") validateGitArgs(args);
  if (program === "find")
    rejectOptions(args, [
      "-delete",
      "-exec",
      "-execdir",
      "-ok",
      "-okdir",
      "-fls",
      "-fprint",
      "-fprint0",
      "-fprintf",
      "-L",
    ]);
  if (program === "rg")
    rejectOptions(args, ["--pre", "--pre-glob", "--search-zip", "--follow", "-L"]);
  if (program === "grep") rejectOptions(args, ["--dereference-recursive", "-R"]);
  if (program === "ls") rejectOptions(args, ["--dereference", "-L"]);
}

function rejectOptions(args: readonly string[], blocked: readonly string[]): void {
  const match = args.find((arg) =>
    blocked.some((option) => arg === option || arg.startsWith(`${option}=`)),
  );
  if (match !== undefined)
    throw new Error(`option ${match} is unavailable in read-only review mode`);
}

function validateGitArgs(args: readonly string[]): void {
  const subcommand = args[0];
  if (subcommand === undefined || !ALLOWED_GIT_COMMANDS.has(subcommand)) {
    throw new Error("Git subcommand is not in the read-only allowlist");
  }
  if (
    args.some((arg) =>
      BLOCKED_GIT_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`)),
    )
  ) {
    throw new Error("Git external helpers and output files are not allowed");
  }
}

async function validatePaths(args: readonly string[], cwd: string): Promise<void> {
  for (const arg of args) {
    if (arg === ".") continue;
    if (arg.startsWith("-")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
      if (value !== undefined && looksLikePath(value)) await validateCheckoutPath(value, cwd);
      continue;
    }
    await validateCheckoutPath(arg, cwd);
  }
}

function looksLikePath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith("~") || value.split(/[\\/]/u).includes("..");
}

export async function validateCheckoutPath(inputPath: string, cwd: string): Promise<void> {
  if (inputPath.startsWith("~") || inputPath.split(/[\\/]/u).includes("..")) {
    throw new Error("paths outside the review checkout are not allowed");
  }
  const root = await realpath(cwd);
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  if (!contains(root, candidate))
    throw new Error("paths outside the review checkout are not allowed");
  const canonical = await realpath(candidate).catch(() => undefined);
  if (canonical !== undefined && !contains(root, canonical)) {
    throw new Error("symlinks outside the review checkout are not allowed");
  }
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function safeGitArgs(args: readonly string[]): readonly string[] {
  const [subcommand, ...rest] = args;
  const inspectionArgs =
    subcommand !== undefined && ["diff", "show", "log", "diff-tree"].includes(subcommand)
      ? [subcommand, "--no-ext-diff", "--no-textconv", ...rest]
      : args;
  return [
    "-c",
    "diff.external=",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.pager=cat",
    "-c",
    "pager.diff=false",
    ...inspectionArgs,
  ];
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_EXTERNAL_DIFF: "",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}
