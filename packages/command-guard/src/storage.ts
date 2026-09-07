import { operation } from "./operations.ts";
import type { DestructiveOperation, ParsedCommand, ResolvedWord } from "./types.ts";

export type StorageClassification = Readonly<{
  operations: readonly DestructiveOperation[];
  denyReason?: string;
  uncertainReason?: string;
}>;

type TargetSelection = Readonly<{
  targets: readonly ResolvedWord[];
  uncertainReason?: string;
}>;

const FORMAT_COMMAND =
  /^(?:mkfs(?:\.[a-z0-9][a-z0-9_+-]*)?|mke2fs|newfs(?:[._][a-z0-9][a-z0-9_+-]*)?)$/u;
const DISKUTIL_DIRECT_DESTRUCTIVE = new Set([
  "partitiondisk",
  "randomdisk",
  "reformat",
  "resetfusion",
  "secureerase",
  "zerodisk",
]);

function positionalWords(args: readonly ResolvedWord[]): TargetSelection {
  const targets: ResolvedWord[] = [];
  let optionsEnded = false;
  let sawTarget = false;
  for (const arg of args) {
    if (!optionsEnded && arg.value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg.value?.startsWith("-")) {
      if (sawTarget) {
        return { targets: [], uncertainReason: "storage options after a target cannot be checked" };
      }
      continue;
    }
    sawTarget = true;
    targets.push(arg);
  }
  return { targets };
}

function selectedTarget(
  targets: readonly ResolvedWord[],
  trailingSize: boolean,
): ResolvedWord | undefined {
  const last = targets.at(-1);
  if (!trailingSize || targets.length < 2 || !/^\d+[kmgtpe]?$/iu.test(last?.value ?? "")) {
    return last;
  }
  return targets.at(-2);
}

function wordList(word: ResolvedWord | undefined): readonly ResolvedWord[] {
  return word ? [word] : [];
}

function commandLabel(command: ParsedCommand): string {
  return command.name.value ?? command.name.raw;
}

function finalTarget(
  command: ParsedCommand,
  options: Readonly<{ trailingSize?: boolean }> = {},
): StorageClassification {
  const selected = positionalWords(command.args);
  if (selected.uncertainReason)
    return { operations: [], uncertainReason: selected.uncertainReason };
  const target = selectedTarget(selected.targets, options.trailingSize === true);
  return {
    operations: [
      operation(commandLabel(command), "device-write", command.source, wordList(target)),
    ],
  };
}

function hasDestructiveWipeOption(args: readonly ResolvedWord[]): boolean {
  return args.some((arg) => {
    const value = arg.value;
    if (!value) return false;
    if (value === "--all" || value === "--offset") return true;
    if (value.startsWith("--all=") || value.startsWith("--offset=")) return true;
    return /^-[^-]*[ao]/u.test(value);
  });
}

function diskutilWords(args: readonly ResolvedWord[]): readonly ResolvedWord[] {
  return args.filter((arg) => !arg.value?.startsWith("-"));
}

function isDestructiveDiskutilGroup(group: string): boolean {
  return group.startsWith("erase") || DISKUTIL_DIRECT_DESTRUCTIVE.has(group);
}

function classifyDiskutilApfs(actionWord: ResolvedWord | undefined): StorageClassification {
  if (!actionWord) return { operations: [] };
  if (!actionWord.value) {
    return { operations: [], uncertainReason: "diskutil apfs subcommand is not fixed" };
  }
  const action = actionWord.value.toLowerCase();
  return action.startsWith("delete") || action.startsWith("erase")
    ? { operations: [], denyReason: `diskutil apfs ${actionWord.value} can erase storage` }
    : { operations: [] };
}

function classifyDiskutil(command: ParsedCommand): StorageClassification {
  const words = diskutilWords(command.args);
  const groupWord = words[0];
  if (!groupWord) return { operations: [] };
  if (!groupWord.value) {
    return { operations: [], uncertainReason: "diskutil subcommand is not fixed" };
  }
  const group = groupWord.value.toLowerCase();
  if (isDestructiveDiskutilGroup(group)) {
    return { operations: [], denyReason: `diskutil ${groupWord.value} can erase storage` };
  }
  return group === "apfs" ? classifyDiskutilApfs(words[1]) : { operations: [] };
}

export function classifyStorage(
  command: ParsedCommand,
  name: string,
): StorageClassification | undefined {
  if (name === "diskutil") return classifyDiskutil(command);
  if (FORMAT_COMMAND.test(name)) return finalTarget(command, { trailingSize: true });
  if (name === "blkdiscard") return finalTarget(command);
  if (name !== "wipefs") return undefined;
  if (hasDestructiveWipeOption(command.args)) return finalTarget(command);
  return command.args.some((arg) => arg.value === undefined)
    ? { operations: [], uncertainReason: "wipefs arguments are not fixed" }
    : { operations: [] };
}
