import { operation } from "./operations.ts";
import type { DestructiveOperation, ParsedCommand, ResolvedWord } from "./types.ts";

const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set(["checkout", "clean", "reset", "restore", "switch"]);

const NATIVE_GIT_SUBCOMMANDS = new Set([
  ...DESTRUCTIVE_GIT_SUBCOMMANDS,
  "status",
  "remote",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "describe",
  "--version",
]);

// Do not turn parsed Git aliases or executable configuration into a new execution route.
export function hasSupportedNativeGitArguments(args: readonly ResolvedWord[]): boolean {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]?.value;
    if (value === undefined) return false;
    if (value === "-C") {
      if (!args[++index]?.value) return false;
      continue;
    }
    if (/^(?:-C.+|--no-pager)$/su.test(value)) continue;
    return NATIVE_GIT_SUBCOMMANDS.has(value);
  }
  return false;
}

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

function gitSubcommandIndex(args: readonly ResolvedWord[]): number {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]?.value ?? "";
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(value)) {
      index++;
      continue;
    }
    if (value.startsWith("-")) continue;
    return DESTRUCTIVE_GIT_SUBCOMMANDS.has(value) ? index : -1;
  }
  return -1;
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
export function classifyGit(command: ParsedCommand): DestructiveOperation[] {
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
    const forced = rest.some(
      (arg) =>
        arg.value === "--discard-changes" ||
        arg.value === "--force" ||
        /^-[^-]*f/u.test(arg.value ?? ""),
    );
    return forced ? [operation("git switch", "replace", command.source, [worktree])] : [];
  }
  if (subcommand === "checkout" && !rest.some((arg) => arg.value === "--")) {
    const forced = rest.some((arg) => arg.value === "--force" || /^-[^-]*f/u.test(arg.value ?? ""));
    return forced ? [operation("git checkout", "replace", command.source, [worktree])] : [];
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
