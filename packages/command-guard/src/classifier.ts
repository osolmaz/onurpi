import { basename } from "node:path";

import { hasPossibleDestructiveToken } from "./lexical.ts";
import { MAX_DESTRUCTIVE_TARGETS, MAX_NESTING_DEPTH } from "./limits.ts";
import type { BashParser } from "./bash-parser.ts";
import { classifyRsync } from "./rsync.ts";
import {
  installedPowerShellParser,
  type PowerShellElement,
  type PowerShellParser,
} from "./powershell-parser.ts";
import type {
  DestructiveKind,
  DestructiveOperation,
  ParsedCommand,
  ParsedScript,
  ResolvedWord,
} from "./types.ts";

export type Classification = Readonly<{
  operations: readonly DestructiveOperation[];
  uncertainReason?: string;
  changesCwd?: boolean;
  referencedVariables?: readonly string[];
}>;

const SHELL_NAMES = new Set(["bash", "sh", "zsh", "dash", "ash"]);
const UNSUPPORTED_SHELL_NAMES = new Set([
  "cmd",
  "csh",
  "fish",
  "ksh",
  "powershell",
  "pwsh",
  "tcsh",
]);
const DYNAMIC_COMMANDS = new Set([".", "alias", "eval", "source", "unalias"]);
const CWD_MUTATORS = new Set(["cd", "popd", "pushd"]);
const EXECUTION_CONTEXT_VARIABLES = new Set([
  "BASHOPTS",
  "BASH_ENV",
  "CDPATH",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ENV",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "HOME",
  "IFS",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "PATH",
  "SHELLOPTS",
  "ZDOTDIR",
]);
const SIMPLE_WRAPPERS = new Set(["builtin", "command", "exec", "nohup", "setsid"]);
const UNSUPPORTED_COMMAND_WRAPPERS = new Set([
  "chroot",
  "chrt",
  "doas",
  "ionice",
  "nice",
  "pkexec",
  "runuser",
  "stdbuf",
  "su",
  "timeout",
]);
const DELETE_COMMANDS = new Set(["rm", "unlink", "rmdir", "shred"]);
const POWERSHELL_DELETE_COMMANDS = new Set([
  "del",
  "erase",
  "rd",
  "remove-item",
  "ri",
  "rm",
  "rmdir",
]);
const POWERSHELL_CLEAR_COMMANDS = new Set(["clc", "clear-content"]);

function commandName(word: ResolvedWord): string | undefined {
  if (!word.value) return undefined;
  const fileName = basename(word.value).toLowerCase();
  return fileName.endsWith(".exe") ? fileName.slice(0, -4) : fileName;
}

function optionText(word: ResolvedWord): string | undefined {
  return word.value?.startsWith("-") ? word.value : undefined;
}

function rmTargets(args: readonly ResolvedWord[]): ResolvedWord[] {
  const targets: ResolvedWord[] = [];
  let options = true;
  for (const arg of args) {
    if (options && arg.value === "--") {
      options = false;
      continue;
    }
    if (options && optionText(arg)) continue;
    targets.push(arg);
  }
  return targets;
}

function rmKind(args: readonly ResolvedWord[]): DestructiveKind {
  for (const arg of args) {
    const option = optionText(arg);
    if (option === "--recursive" || (option?.startsWith("-") && /[rR]/u.test(option.slice(1)))) {
      return "recursive-delete";
    }
  }
  return "delete";
}

function operation(
  command: string,
  kind: DestructiveKind,
  source: string,
  targets: readonly ResolvedWord[],
): DestructiveOperation {
  return { command, kind, source, targets };
}

function classifyFind(command: ParsedCommand): DestructiveOperation[] {
  const values = command.args.map((arg) => arg.value);
  if (!values.includes("-delete")) return [];
  const roots: ResolvedWord[] = [];
  for (const arg of command.args) {
    if (arg.value?.startsWith("-")) break;
    roots.push(arg);
  }
  return [
    operation(
      "find",
      "recursive-delete",
      command.source,
      roots.length > 0 ? roots : [{ raw: ".", value: ".", referencedVariables: [] }],
    ),
  ];
}

// eslint-disable-next-line complexity -- find has several explicit command terminators.
function findEmbeddedCommands(command: ParsedCommand): ParsedCommand[] {
  const embedded: ParsedCommand[] = [];
  for (let index = 0; index < command.args.length; index++) {
    const value = command.args[index]?.value;
    if (value !== "-exec" && value !== "-execdir" && value !== "-ok" && value !== "-okdir") {
      continue;
    }
    const words: ResolvedWord[] = [];
    for (let cursor = index + 1; cursor < command.args.length; cursor++) {
      const arg = command.args[cursor];
      if (!arg || arg.value === ";" || arg.value === "+") break;
      words.push(arg);
    }
    const [name, ...args] = words;
    if (name) embedded.push({ name, args, source: command.source });
  }
  return embedded;
}

const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set(["checkout", "clean", "reset", "restore", "switch"]);

function gitSubcommandIndex(args: readonly ResolvedWord[]): number {
  return args.findIndex((arg) => DESTRUCTIVE_GIT_SUBCOMMANDS.has(arg.value ?? ""));
}

function gitHasAlternateWorktree(args: readonly ResolvedWord[], subcommandIndex: number): boolean {
  return args
    .slice(0, subcommandIndex)
    .some((arg) =>
      /^(?:-C|--git-dir(?:=|$)|--work-tree(?:=|$)|--namespace(?:=|$))/u.test(arg.value ?? ""),
    );
}

// eslint-disable-next-line complexity -- Git restore options and path separators need one ordered scan.
function gitPathTargets(rest: readonly ResolvedWord[]): readonly ResolvedWord[] {
  const separator = rest.findIndex((arg) => arg.value === "--");
  if (separator >= 0) return rest.slice(separator + 1);
  const optionsWithValue = new Set(["-s", "--source", "--conflict", "--pathspec-from-file"]);
  const targets: ResolvedWord[] = [];
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index]?.value;
    if (value?.startsWith("--") && value.includes("=")) continue;
    if (value && optionsWithValue.has(value)) {
      index++;
      continue;
    }
    if (!value?.startsWith("-")) {
      const target = rest[index];
      if (target) targets.push(target);
    }
  }
  return targets;
}

// eslint-disable-next-line complexity -- Keep related destructive Git forms in one classifier.
function classifyGit(command: ParsedCommand): DestructiveOperation[] {
  const subcommandIndex = gitSubcommandIndex(command.args);
  if (subcommandIndex < 0) return [];
  const subcommand = command.args[subcommandIndex]?.value;
  const rest = command.args.slice(subcommandIndex + 1);
  const cwd = { raw: ".", value: ".", referencedVariables: [] } satisfies ResolvedWord;
  const uncertainCwd = {
    raw: "git worktree option",
    referencedVariables: [],
    reason: "Git uses an alternate working tree",
  } satisfies ResolvedWord;
  const worktree = gitHasAlternateWorktree(command.args, subcommandIndex) ? uncertainCwd : cwd;
  if (subcommand === "clean") {
    const forced = rest.some((arg) => arg.value === "--force" || /^-[^-]*f/u.test(arg.value ?? ""));
    return forced ? [operation("git clean", "git-clean", command.source, [worktree])] : [];
  }
  if (subcommand === "reset" && rest.some((arg) => arg.value === "--hard")) {
    return [operation("git reset --hard", "git-reset", command.source, [worktree])];
  }
  if (subcommand === "switch") {
    return [operation("git switch", "replace", command.source, [worktree])];
  }
  if (subcommand === "checkout" && !rest.some((arg) => arg.value === "--")) {
    return [operation("git checkout", "replace", command.source, [worktree])];
  }
  if (subcommand !== "restore" && subcommand !== "checkout") return [];
  const targets = gitPathTargets(rest);
  return [
    operation(`git ${subcommand}`, "replace", command.source, [
      {
        raw: targets.map((target) => target.raw).join(" ") || "Git pathspec",
        referencedVariables: targets.flatMap((target) => target.referencedVariables),
        reason: "Git pathspec targets cannot be canonicalized without running Git",
      },
    ]),
  ];
}

function classifyTruncate(command: ParsedCommand): DestructiveOperation[] {
  const targets = rmTargets(command.args);
  return [operation("truncate", "truncate", command.source, targets)];
}

function classifyDd(command: ParsedCommand): DestructiveOperation[] {
  const targets = command.args.flatMap((arg) => {
    if (!arg.value?.startsWith("of=")) return [];
    return [{ ...arg, raw: arg.raw.slice(3), value: arg.value.slice(3) }];
  });
  return targets.length > 0 ? [operation("dd", "replace", command.source, targets)] : [];
}

function classifyDirect(command: ParsedCommand): DestructiveOperation[] {
  const name = commandName(command.name);
  if (!name) return [];
  if (DELETE_COMMANDS.has(name)) {
    return [operation(name, rmKind(command.args), command.source, rmTargets(command.args))];
  }
  if (name === "find") return classifyFind(command);
  if (name === "rsync") return classifyRsync(command);
  if (name === "git") return classifyGit(command);
  if (name === "truncate") return classifyTruncate(command);
  if (name === "dd") return classifyDd(command);
  return [];
}

// eslint-disable-next-line complexity -- Each simple wrapper has a small closed option set.
function simpleWrapperCommandIndex(name: string, args: readonly ResolvedWord[]): number {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]?.value;
    if (!value) return -1;
    if (value === "--") return index + 1;
    if (!value.startsWith("-") || value === "-") return index;
    if (name === "exec" && value === "-a") {
      index++;
      continue;
    }
    if (name === "exec" && /^-[cl]+$/u.test(value)) continue;
    if ((name === "command" || name === "builtin") && /^-[pVv]+$/u.test(value)) continue;
    if (name === "nohup" && (value === "--help" || value === "--version")) continue;
    if (name === "setsid" && ["-c", "--ctty", "-f", "--fork", "-w", "--wait"].includes(value)) {
      continue;
    }
    return -1;
  }
  return -1;
}

function unwrapSimple(command: ParsedCommand): ParsedCommand | undefined {
  const name = commandName(command.name);
  if (!name || !SIMPLE_WRAPPERS.has(name)) return undefined;
  const index = simpleWrapperCommandIndex(name, command.args);
  const nestedName = command.args[index];
  return index >= 0 && nestedName
    ? { name: nestedName, args: command.args.slice(index + 1), source: command.source }
    : undefined;
}

type OptionWrapper = "env" | "sudo" | "xargs";

const WRAPPER_OPTIONS_WITH_VALUE: Readonly<Record<OptionWrapper, ReadonlySet<string>>> = {
  env: new Set(["-a", "--argv0", "-C", "--chdir", "-S", "--split-string", "-u", "--unset"]),
  sudo: new Set([
    "-a",
    "--auth-type",
    "-C",
    "--close-from",
    "-D",
    "--chdir",
    "-g",
    "--group",
    "-h",
    "--host",
    "-p",
    "--prompt",
    "-r",
    "--role",
    "-R",
    "--chroot",
    "-t",
    "--type",
    "-T",
    "--command-timeout",
    "-u",
    "--user",
    "-U",
    "--other-user",
  ]),
  xargs: new Set([
    "-a",
    "--arg-file",
    "-d",
    "--delimiter",
    "-E",
    "--eof",
    "-e",
    "-I",
    "--replace",
    "-L",
    "--max-lines",
    "-n",
    "--max-args",
    "-P",
    "--max-procs",
    "--process-slot-var",
    "-s",
    "--max-chars",
  ]),
};
const WRAPPER_OPTIONS_WITHOUT_VALUE: Readonly<Record<OptionWrapper, ReadonlySet<string>>> = {
  env: new Set(["-", "-0", "--null", "-i", "--ignore-environment", "-v", "--debug"]),
  sudo: new Set([
    "-A",
    "--askpass",
    "-b",
    "--background",
    "-E",
    "--preserve-env",
    "-e",
    "--edit",
    "-H",
    "--set-home",
    "-i",
    "--login",
    "-K",
    "--remove-timestamp",
    "-k",
    "--reset-timestamp",
    "-l",
    "--list",
    "-n",
    "--non-interactive",
    "-P",
    "--preserve-groups",
    "-S",
    "--stdin",
    "-V",
    "--version",
    "-v",
    "--validate",
  ]),
  xargs: new Set([
    "-0",
    "--null",
    "-o",
    "--open-tty",
    "-p",
    "--interactive",
    "-r",
    "--no-run-if-empty",
    "--show-limits",
    "-t",
    "--verbose",
    "-x",
    "--exit",
  ]),
};
const WRAPPER_SHORT_OPTIONS_WITH_VALUE: Readonly<Record<OptionWrapper, ReadonlySet<string>>> = {
  env: new Set(["a", "C", "S", "u"]),
  sudo: new Set(["a", "C", "D", "g", "h", "p", "r", "R", "t", "T", "u", "U"]),
  xargs: new Set(["a", "d", "E", "e", "I", "L", "n", "P", "s"]),
};
const WRAPPER_SHORT_OPTIONS_WITHOUT_VALUE: Readonly<Record<OptionWrapper, ReadonlySet<string>>> = {
  env: new Set(["0", "i", "v"]),
  sudo: new Set(["A", "b", "E", "e", "H", "i", "K", "k", "l", "n", "P", "S", "V", "v"]),
  xargs: new Set(["0", "o", "p", "r", "t", "x"]),
};

function knownLongWrapperOption(
  value: string,
  wrapper: OptionWrapper,
): "next" | "same" | undefined {
  const option = value.split("=", 1)[0] ?? value;
  if (WRAPPER_OPTIONS_WITH_VALUE[wrapper].has(option)) {
    return value.includes("=") ? "same" : "next";
  }
  if (WRAPPER_OPTIONS_WITHOUT_VALUE[wrapper].has(value)) return "same";
  if (wrapper === "sudo" && value.startsWith("--preserve-env=")) return "same";
  return undefined;
}

// eslint-disable-next-line complexity -- Unknown wrapper options fail closed instead of hiding a command.
function commandIndexAfterOptions(args: readonly ResolvedWord[], wrapper: OptionWrapper): number {
  const assignments = wrapper === "env" || wrapper === "sudo";
  for (let index = 0; index < args.length; index++) {
    const value = args[index]?.value;
    if (!value) return -1;
    if (value === "--") return index + 1;
    if (assignments && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)) continue;
    if (!value.startsWith("-") || value === "-") return index;
    if (value.startsWith("--")) {
      const known = knownLongWrapperOption(value, wrapper);
      if (!known) return -1;
      if (known === "next") index++;
      continue;
    }
    const flags = value.slice(1);
    for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
      const flag = flags[flagIndex] ?? "";
      if (WRAPPER_SHORT_OPTIONS_WITHOUT_VALUE[wrapper].has(flag)) continue;
      if (!WRAPPER_SHORT_OPTIONS_WITH_VALUE[wrapper].has(flag)) return -1;
      if (flagIndex === flags.length - 1) index++;
      break;
    }
  }
  return -1;
}

function unwrapEnvOrSudo(command: ParsedCommand): ParsedCommand | undefined {
  const name = commandName(command.name);
  if (name !== "env" && name !== "sudo") return undefined;
  const index = commandIndexAfterOptions(command.args, name);
  const nestedName = command.args[index];
  return index >= 0 && nestedName
    ? { name: nestedName, args: command.args.slice(index + 1), source: command.source }
    : undefined;
}

function unwrapBusybox(command: ParsedCommand): ParsedCommand | undefined {
  if (commandName(command.name) !== "busybox") return undefined;
  const name = command.args[0];
  return name?.value && !name.value.startsWith("-")
    ? { name, args: command.args.slice(1), source: command.source }
    : undefined;
}

function unwrapXargs(command: ParsedCommand): ParsedCommand | undefined {
  if (commandName(command.name) !== "xargs") return undefined;
  const index = commandIndexAfterOptions(command.args, "xargs");
  const name = command.args[index];
  return index >= 0 && name
    ? { name, args: command.args.slice(index + 1), source: command.source }
    : undefined;
}

function isWrapperCommand(name: string | undefined): boolean {
  return (
    name !== undefined &&
    (SIMPLE_WRAPPERS.has(name) || ["busybox", "env", "sudo", "xargs"].includes(name))
  );
}

async function nestedShellOperations(
  command: ParsedCommand,
  parser: BashParser,
  environment: NodeJS.ProcessEnv,
  depth: number,
): Promise<Classification | undefined> {
  const name = commandName(command.name);
  if (!name || !SHELL_NAMES.has(name)) return undefined;
  const commandIndex = command.args.findIndex((arg) => arg.value === "-c" || arg.value === "-lc");
  const source = command.args[commandIndex + 1];
  if (commandIndex < 0 || !source) {
    return { operations: [], uncertainReason: "nested shell source cannot be checked" };
  }
  if (!source.value)
    return { operations: [], uncertainReason: "nested shell source is not literal" };
  return classifyParsed(parser.parse(source.value, environment), parser, environment, depth + 1);
}

async function trapOperations(
  command: ParsedCommand,
  parser: BashParser,
  environment: NodeJS.ProcessEnv,
  depth: number,
): Promise<Classification | undefined> {
  if (commandName(command.name) !== "trap") return undefined;
  const first = command.args[0]?.value === "--" ? 1 : 0;
  const source = command.args[first];
  if (!source || source.value === "-l" || source.value === "-p") return { operations: [] };
  if (!source.value) return { operations: [], uncertainReason: "trap source is not literal" };
  return classifyParsed(parser.parse(source.value, environment), parser, environment, depth + 1);
}

function combine(current: Classification, next: Classification): Classification {
  const referencedVariables = new Set([
    ...(current.referencedVariables ?? []),
    ...(next.referencedVariables ?? []),
  ]);
  const uncertainReason = current.uncertainReason ?? next.uncertainReason;
  return {
    operations: [...current.operations, ...next.operations],
    ...(uncertainReason ? { uncertainReason } : {}),
    changesCwd: current.changesCwd === true || next.changesCwd === true,
    referencedVariables: [...referencedVariables].sort(),
  };
}

// eslint-disable-next-line complexity -- Command families and wrappers share one bounded recursion point.
async function classifyCommand(
  command: ParsedCommand,
  parser: BashParser,
  environment: NodeJS.ProcessEnv,
  depth: number,
): Promise<Classification> {
  if (depth > MAX_NESTING_DEPTH) {
    return { operations: [], uncertainReason: "nested command depth exceeds safety limit" };
  }
  const name = commandName(command.name);
  if (name && CWD_MUTATORS.has(name)) return { operations: [], changesCwd: true };
  if (
    (name === "env" || name === "sudo") &&
    command.args.some((argument) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(argument.value ?? ""))
  ) {
    return { operations: [], uncertainReason: `${name} environment assignments cannot be checked` };
  }
  if (name && UNSUPPORTED_COMMAND_WRAPPERS.has(name)) {
    return { operations: [], uncertainReason: `${name} wrapped command cannot be checked` };
  }
  if (
    (name === "env" || name === "sudo") &&
    command.args.some((argument) =>
      /^(?:-[CDR].*|--(?:chdir|chroot)(?:=.*)?|-i|--login|-s|--shell)$/u.test(argument.value ?? ""),
    )
  ) {
    return { operations: [], uncertainReason: `${name} changes command execution context` };
  }
  if (name && DYNAMIC_COMMANDS.has(name)) {
    return { operations: [], uncertainReason: `${name} command source cannot be checked` };
  }
  if (
    name === "env" &&
    command.args.some((argument) => argument.value === "-S" || argument.value === "--split-string")
  ) {
    return { operations: [], uncertainReason: "env split-string command cannot be checked" };
  }
  if (name && UNSUPPORTED_SHELL_NAMES.has(name)) {
    return { operations: [], uncertainReason: `${name} shell source cannot be checked` };
  }
  let result: Classification = { operations: classifyDirect(command) };
  for (const nested of findEmbeddedCommands(command)) {
    result = combine(result, await classifyCommand(nested, parser, environment, depth + 1));
  }
  const wrapper =
    unwrapSimple(command) ??
    unwrapEnvOrSudo(command) ??
    unwrapBusybox(command) ??
    unwrapXargs(command);
  if (wrapper) {
    result = combine(result, await classifyCommand(wrapper, parser, environment, depth + 1));
  } else if (isWrapperCommand(name) && command.args.length > 0) {
    result = combine(result, {
      operations: [],
      uncertainReason: `${name ?? "command"} wrapper options cannot be checked`,
    });
  }
  const nestedShell = await nestedShellOperations(command, parser, environment, depth);
  if (nestedShell) result = combine(result, nestedShell);
  const trap = await trapOperations(command, parser, environment, depth);
  return trap ? combine(result, trap) : result;
}

function assignedContextReason(script: ParsedScript): string | undefined {
  const assigned = [...script.assignedVariables].sort();
  const securityVariable = assigned.find(
    (name) => EXECUTION_CONTEXT_VARIABLES.has(name) || name.startsWith("GIT_CONFIG_"),
  );
  if (securityVariable) return `variable ${securityVariable} is assigned in the script`;
  const hasNestedSource = script.commands.some((command) =>
    [command.name, ...command.args].some((word) => {
      const name = commandName(word);
      return name === "trap" || (name !== undefined && SHELL_NAMES.has(name));
    }),
  );
  return hasNestedSource && assigned[0]
    ? `variable ${assigned[0]} is assigned before nested shell code`
    : undefined;
}

// eslint-disable-next-line complexity -- Aggregate fail-closed parser evidence in one pass.
async function classifyParsed(
  script: ParsedScript,
  parser: BashParser,
  environment: NodeJS.ProcessEnv,
  depth: number,
): Promise<Classification> {
  if (depth > MAX_NESTING_DEPTH) {
    return { operations: [], uncertainReason: "nested command depth exceeds safety limit" };
  }
  const contextReason = assignedContextReason(script);
  if (contextReason) return { operations: [], uncertainReason: contextReason };
  const referencedVariables = new Set<string>();
  for (const command of script.commands) {
    for (const word of [command.name, ...command.args]) {
      for (const name of word.referencedVariables) referencedVariables.add(name);
    }
  }
  for (const redirect of script.redirects) {
    for (const name of redirect.destination.referencedVariables) referencedVariables.add(name);
  }
  let result: Classification = {
    operations: [],
    referencedVariables: [...referencedVariables].sort(),
  };
  for (const command of script.commands) {
    result = combine(result, await classifyCommand(command, parser, environment, depth));
  }
  for (const redirect of script.redirects) {
    if (redirect.operator === ">" || redirect.operator === ">|") {
      result = combine(result, {
        operations: [
          operation("shell redirection", "truncate", redirect.source, [redirect.destination]),
        ],
      });
    }
  }
  const hasUnresolvedCommand = script.commands.some((command) => command.name.value === undefined);
  if (hasUnresolvedCommand) {
    result = combine(result, {
      operations: [],
      uncertainReason: "dynamic command name is not safe",
    });
  }
  if (script.hasError && hasPossibleDestructiveToken(script.source)) {
    result = combine(result, { operations: [], uncertainReason: "shell syntax contains errors" });
  }
  if (result.changesCwd === true && result.operations.length > 0) {
    result = combine(result, {
      operations: [],
      uncertainReason: "working directory changes before a destructive command",
    });
  }
  const targetCount = result.operations.reduce((count, item) => count + item.targets.length, 0);
  if (targetCount > MAX_DESTRUCTIVE_TARGETS) {
    return { operations: [], uncertainReason: "destructive target count exceeds safety limit" };
  }
  return result;
}

export async function classifyBash(
  source: string,
  environment: NodeJS.ProcessEnv,
  parser: BashParser,
): Promise<Classification> {
  if (/\\\r?\n/u.test(source)) {
    return { operations: [], uncertainReason: "shell line continuations cannot be checked" };
  }
  return classifyParsed(parser.parse(source, environment), parser, environment, 0);
}

// eslint-disable-next-line complexity -- Conservative fallback tokenization needs explicit quote states.
function wordsFromCommandLine(source: string): ResolvedWord[] | undefined {
  const words: ResolvedWord[] = [];
  let current = "";
  let quote: "none" | "single" | "double" = "none";
  const push = (): void => {
    if (current) words.push({ raw: current, value: current, referencedVariables: [] });
    current = "";
  };
  for (const char of source) {
    if (char === "'" && quote !== "double") {
      quote = quote === "single" ? "none" : "single";
      continue;
    }
    if (char === '"' && quote !== "single") {
      quote = quote === "double" ? "none" : "double";
      continue;
    }
    if (quote === "none" && /\s/u.test(char)) {
      push();
      continue;
    }
    if (char === "^") return undefined;
    current += char;
  }
  if (quote !== "none") return undefined;
  push();
  return words;
}

function powerShellWord(element: PowerShellElement): ResolvedWord {
  if (element.value !== undefined) {
    return { raw: element.text, value: element.value, referencedVariables: [] };
  }
  if (element.kind === "CommandParameterAst") {
    return { raw: element.text, value: element.text, referencedVariables: [] };
  }
  return {
    raw: element.text,
    referencedVariables: [],
    reason: `PowerShell ${element.kind} is not a fixed string`,
  };
}

function classifyPowerShellCommand(
  name: string,
  source: string,
  elements: readonly PowerShellElement[],
): DestructiveOperation[] {
  const normalized = name.toLowerCase();
  const args = elements.slice(1).map(powerShellWord);
  if (POWERSHELL_DELETE_COMMANDS.has(normalized)) {
    return [operation(name, "recursive-delete", source, rmTargets(args))];
  }
  if (POWERSHELL_CLEAR_COMMANDS.has(normalized)) {
    return [operation(name, "truncate", source, rmTargets(args))];
  }
  return [];
}

function hasTruncatingRedirection(source: string): boolean {
  return /(^|[^>])>(?!>)/u.test(source);
}

function hasDynamicPowerShellCommand(source: string): boolean {
  return (
    /\b(?:iex|invoke-expression|new-alias|saps|set-alias|start-process)\b/iu.test(source) ||
    /(?:^|[;|\n])\s*\.\s+/u.test(source) ||
    /&\s*[$(]/u.test(source)
  );
}

function hasPowerShellLauncher(source: string): boolean {
  return /\b(?:cmd|powershell|pwsh)\b/iu.test(source);
}

// eslint-disable-next-line complexity -- Parser availability, syntax, and target certainty fail closed in one pass.
export async function classifyPowerShell(
  source: string,
  parser: PowerShellParser = installedPowerShellParser,
): Promise<Classification> {
  if (hasDynamicPowerShellCommand(source)) {
    return { operations: [], uncertainReason: "dynamic PowerShell command cannot be checked" };
  }
  if (
    !hasPossibleDestructiveToken(source) &&
    !hasPowerShellLauncher(source) &&
    !hasTruncatingRedirection(source)
  ) {
    return { operations: [] };
  }
  const parsed = await parser.parse(source);
  if (!parsed) {
    return { operations: [], uncertainReason: "official PowerShell parser is unavailable" };
  }
  if (parsed.errors.length > 0) {
    return { operations: [], uncertainReason: "PowerShell syntax contains errors" };
  }
  let operations = parsed.commands.flatMap((command) =>
    command.name ? classifyPowerShellCommand(command.name, command.source, command.elements) : [],
  );
  operations = [
    ...operations,
    ...parsed.redirects.map((redirect) =>
      operation("PowerShell redirection", "truncate", redirect.source, [
        powerShellWord(redirect.destination),
      ]),
    ),
  ];
  const dynamic = parsed.commands.some((command) => command.name === undefined);
  const uncertainTarget = operations.some((item) =>
    item.targets.some((target) => target.value === undefined),
  );
  if (dynamic || uncertainTarget || operations.length === 0) {
    return { operations, uncertainReason: "PowerShell command or target is not a fixed string" };
  }
  const targetCount = operations.reduce((count, item) => count + item.targets.length, 0);
  return targetCount > MAX_DESTRUCTIVE_TARGETS
    ? { operations: [], uncertainReason: "destructive target count exceeds safety limit" }
    : { operations };
}

// eslint-disable-next-line complexity -- Cmd expansion and compound syntax are blocked before tokenization.
function classifySimpleShell(source: string, shellKind: "cmd"): Classification {
  if (/[%!^&|()]/u.test(source)) {
    return { operations: [], uncertainReason: "cmd expansion or compound syntax is not safe" };
  }
  if (hasTruncatingRedirection(source)) {
    return { operations: [], uncertainReason: "cmd truncating redirection is not safely parsed" };
  }
  const words = wordsFromCommandLine(source);
  if (!words?.[0]) return { operations: [], uncertainReason: `${shellKind} command is not clear` };
  const name = commandName(words[0]);
  const args = words.slice(1);
  if (args.some((word) => /[$*?{}]/u.test(word.value ?? ""))) {
    return { operations: [], uncertainReason: `${shellKind} target expansion is not clear` };
  }
  if (["del", "erase", "rd", "rmdir"].includes(name ?? "")) {
    const targets = args.filter((arg) => !/^\/[A-Za-z?]+$/u.test(arg.value ?? ""));
    return { operations: [operation(name ?? "del", "recursive-delete", source, targets)] };
  }
  return hasPossibleDestructiveToken(source)
    ? {
        operations: [],
        uncertainReason: `possible destructive ${shellKind} command is unsupported`,
      }
    : { operations: [] };
}

export function classifyNonBash(source: string, shellKind: "cmd"): Classification {
  return classifySimpleShell(source, shellKind);
}
