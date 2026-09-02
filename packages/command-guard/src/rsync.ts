import type { DestructiveOperation, ParsedCommand, ResolvedWord } from "./types.ts";

const OPTIONS_WITH_VALUE = new Set([
  "--backup-dir",
  "--block-size",
  "--bwlimit",
  "--checksum-choice",
  "--chmod",
  "--chown",
  "--compare-dest",
  "--compress-choice",
  "--compress-level",
  "--copy-as",
  "--copy-dest",
  "--debug",
  "--exclude",
  "--exclude-from",
  "--files-from",
  "--filter",
  "--groupmap",
  "--include",
  "--include-from",
  "--link-dest",
  "--log-file",
  "--log-file-format",
  "--max-alloc",
  "--max-delete",
  "--max-size",
  "--min-size",
  "--modify-window",
  "--out-format",
  "--password-file",
  "--port",
  "--remote-option",
  "--rsync-path",
  "--rsh",
  "--sockopts",
  "--suffix",
  "--temp-dir",
  "--timeout",
  "--usermap",
]);
const OPTIONS_WITHOUT_VALUE = new Set([
  "--8-bit-output",
  "--acls",
  "--append",
  "--append-verify",
  "--archive",
  "--backup",
  "--checksum",
  "--compress",
  "--copy-dirlinks",
  "--copy-links",
  "--copy-unsafe-links",
  "--delete",
  "--delete-after",
  "--delete-before",
  "--delete-delay",
  "--delete-during",
  "--delete-excluded",
  "--delete-missing-args",
  "--devices",
  "--dirs",
  "--dry-run",
  "--existing",
  "--fuzzy",
  "--group",
  "--hard-links",
  "--human-readable",
  "--ignore-errors",
  "--ignore-existing",
  "--ignore-missing-args",
  "--ignore-times",
  "--itemize-changes",
  "--links",
  "--list-only",
  "--munge-links",
  "--no-implied-dirs",
  "--numeric-ids",
  "--omit-dir-times",
  "--one-file-system",
  "--owner",
  "--partial",
  "--perms",
  "--prune-empty-dirs",
  "--protect-args",
  "--quiet",
  "--recursive",
  "--relative",
  "--remove-source-files",
  "--safe-links",
  "--size-only",
  "--sparse",
  "--specials",
  "--stats",
  "--super",
  "--times",
  "--update",
  "--verbose",
  "--whole-file",
  "--xattrs",
]);
const SHORT_OPTIONS_WITH_VALUE = new Set(["B", "e", "f", "M", "T"]);
const SHORT_OPTIONS_WITHOUT_VALUE = new Set("ACDEHIKLORPSUWXabcdghiklmnopqrstuvxyz");

type RsyncOperands = Readonly<{
  operands: readonly ResolvedWord[];
  uncertainOption?: string;
}>;

// eslint-disable-next-line complexity -- Unknown value-taking options must not hide the destination.
function rsyncOperands(args: readonly ResolvedWord[]): RsyncOperands {
  const operands: ResolvedWord[] = [];
  let options = true;
  for (let index = 0; index < args.length; index++) {
    const value = args[index]?.value;
    if (!value) return { operands, uncertainOption: "non-literal rsync option or operand" };
    if (options && value === "--") {
      options = false;
      continue;
    }
    if (options && value.startsWith("--")) {
      const option = value.split("=", 1)[0] ?? value;
      if (OPTIONS_WITH_VALUE.has(option)) {
        if (!value.includes("=")) index++;
        continue;
      }
      if (OPTIONS_WITHOUT_VALUE.has(value)) continue;
      return { operands, uncertainOption: `unsupported rsync option ${value}` };
    }
    if (options && value.startsWith("-") && value !== "-") {
      const flags = value.slice(1);
      for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
        const flag = flags[flagIndex] ?? "";
        if (SHORT_OPTIONS_WITHOUT_VALUE.has(flag)) continue;
        if (SHORT_OPTIONS_WITH_VALUE.has(flag)) {
          if (flagIndex === flags.length - 1) index++;
          break;
        }
        return { operands, uncertainOption: `unsupported rsync option -${flag}` };
      }
      continue;
    }
    const operand = args[index];
    if (operand) operands.push(operand);
  }
  return { operands };
}

function operation(command: ParsedCommand, targets: readonly ResolvedWord[]): DestructiveOperation {
  return {
    command: "rsync",
    kind: "recursive-delete",
    source: command.source,
    targets,
  };
}

export function classifyRsync(command: ParsedCommand): DestructiveOperation[] {
  const deleting = command.args.some((arg) => arg.value?.startsWith("--delete"));
  if (!deleting) return [];
  const parsed = rsyncOperands(command.args);
  if (parsed.uncertainOption) {
    return [
      operation(command, [
        { raw: "rsync options", referencedVariables: [], reason: parsed.uncertainOption },
      ]),
    ];
  }
  const target = parsed.operands.at(-1);
  if (target?.value?.includes(":") && !/^[A-Za-z]:[\\/]/u.test(target.value)) {
    return [
      operation(command, [
        {
          raw: target.raw,
          referencedVariables: target.referencedVariables,
          reason: "rsync remote target cannot be checked locally",
        },
      ]),
    ];
  }
  return [operation(command, target ? [target] : [])];
}
