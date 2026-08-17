import {
  ASSISTANT_MODES,
  INCLUDE_KINDS,
  OUTPUT_FORMATS,
  type AssistantMode,
  type IncludeKind,
  type OutputFormat,
  type ParsedCommand,
  type RecoveryOptions,
} from "./types.js";

const DEFAULT_LAST = 20;
const DEFAULT_LIST_LIMIT = 20;

export function parseArgs(args: readonly string[]): ParsedCommand {
  const [first, ...rest] = args;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    return { kind: "help" };
  }
  if (first === "list") return parseList(rest);
  if (first === "entry") return parseEntry(rest);
  return parseShow(first, rest);
}

function parseShow(session: string, args: readonly string[]): ParsedCommand {
  const fields: {
    last: number;
    assistant: AssistantMode;
    include: Set<IncludeKind>;
    since?: string;
    format: OutputFormat;
    allProjects: boolean;
  } = {
    last: DEFAULT_LAST,
    assistant: "final",
    include: new Set(INCLUDE_KINDS),
    format: "text",
    allProjects: false,
  };
  const seen = new Set<string>();
  consumeOptions(args, (option, value) => {
    rejectDuplicate(seen, option);
    switch (option) {
      case "--last":
        fields.last = positiveInteger(requiredValue(value, option), option);
        return;
      case "--assistant":
        fields.assistant = enumValue(requiredValue(value, option), ASSISTANT_MODES, option);
        return;
      case "--include":
        fields.include = parseIncludes(requiredValue(value, option));
        return;
      case "--since":
        fields.since = requiredValue(value, option);
        return;
      case "--format":
        fields.format = enumValue(requiredValue(value, option), OUTPUT_FORMATS, option);
        return;
      case "--all-projects":
        noValue(value, option);
        fields.allProjects = true;
        return;
      default:
        throw new Error(`unknown option: ${option}`);
    }
  });
  const options: RecoveryOptions = {
    last: fields.last,
    assistant: fields.assistant,
    include: fields.include,
    ...(fields.since === undefined ? {} : { since: fields.since }),
    format: fields.format,
    allProjects: fields.allProjects,
  };
  return { kind: "show", session, options };
}

function parseList(args: readonly string[]): ParsedCommand {
  let allProjects = false;
  let limit = DEFAULT_LIST_LIMIT;
  let format: OutputFormat = "text";
  const seen = new Set<string>();
  consumeOptions(args, (option, value) => {
    rejectDuplicate(seen, option);
    if (option === "--all-projects") {
      noValue(value, option);
      allProjects = true;
    } else if (option === "--limit") {
      limit = positiveInteger(requiredValue(value, option), option);
    } else if (option === "--format") {
      format = enumValue(requiredValue(value, option), OUTPUT_FORMATS, option);
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  });
  return { kind: "list", allProjects, limit, format };
}

function parseEntry(args: readonly string[]): ParsedCommand {
  const [session, entryId, ...options] = args;
  if (session === undefined || entryId === undefined) {
    throw new Error("usage: pi-session entry <session> <entry-id> [--format <text|json>]");
  }
  let allProjects = false;
  let format: OutputFormat = "text";
  const seen = new Set<string>();
  consumeOptions(options, (option, value) => {
    rejectDuplicate(seen, option);
    if (option === "--format") {
      format = enumValue(requiredValue(value, option), OUTPUT_FORMATS, option);
    } else if (option === "--all-projects") {
      noValue(value, option);
      allProjects = true;
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  });
  return { kind: "entry", session, entryId, allProjects, format };
}

function consumeOptions(
  args: readonly string[],
  consume: (option: string, value: string | undefined) => void,
): void {
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option?.startsWith("--")) {
      throw new Error(`unexpected argument: ${option ?? ""}`);
    }
    const takesValue = option !== "--all-projects";
    const value = takesValue ? args[index + 1] : undefined;
    consume(option, value);
    if (takesValue) index += 1;
  }
}

function requiredValue(value: string | undefined, option: string): string {
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function noValue(value: string | undefined, option: string): void {
  if (value !== undefined) throw new Error(`${option} does not accept a value`);
}

function positiveInteger(value: string, option: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${option} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function enumValue<const T extends readonly string[]>(
  value: string,
  allowed: T,
  option: string,
): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${option} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function parseIncludes(value: string): Set<IncludeKind> {
  if (value === "none") return new Set();
  const includes = new Set<IncludeKind>();
  for (const part of value.split(",")) {
    const include = INCLUDE_KINDS.find((candidate) => candidate === part);
    if (include === undefined) {
      throw new Error(`--include must be a comma-separated subset of: ${INCLUDE_KINDS.join(", ")}`);
    }
    includes.add(include);
  }
  return includes;
}

function rejectDuplicate(seen: Set<string>, option: string): void {
  if (seen.has(option)) throw new Error(`duplicate option: ${option}`);
  seen.add(option);
}
