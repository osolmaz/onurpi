import {
  THINKING_LEVELS,
  type ReviewRequest,
  type ReviewTarget,
  type ThinkingLevel,
} from "./types.js";

const MAX_INPUT_CHARS = 16_384;

export type ParsedCommand =
  | { readonly kind: "review"; readonly request: ReviewRequest }
  | { readonly kind: "config-show" }
  | { readonly kind: "config-reset" }
  | { readonly kind: "config-set-model"; readonly model: string }
  | { readonly kind: "config-set-thinking"; readonly thinking: ThinkingLevel }
  | { readonly kind: "login"; readonly provider?: string }
  | { readonly kind: "models"; readonly search?: string }
  | { readonly kind: "help" }
  | { readonly kind: "version" };

type ReviewFields = {
  cwd: string;
  model?: string;
  thinking?: ThinkingLevel;
  title?: string;
  target?: ReviewTarget;
  custom: string[];
};

export function parseArgs(args: readonly string[], cwd = process.cwd()): ParsedCommand {
  const [command, ...rest] = args;
  if (["--help", "-h", "help"].includes(command ?? "")) return { kind: "help" };
  if (["--version", "-v"].includes(command ?? "")) return { kind: "version" };
  const special = parseSpecialCommand(command, rest);
  return special ?? { kind: "review", request: parseReview(args, cwd) };
}

function parseSpecialCommand(
  command: string | undefined,
  args: readonly string[],
): ParsedCommand | undefined {
  if (command === "config") return parseConfig(args);
  if (command === "login") return parseLogin(args);
  if (command === "models") return parseModels(args);
  return undefined;
}

function parseConfig(args: readonly string[]): ParsedCommand {
  const [action, ...rest] = args;
  if (action === "show") return noConfigArguments(rest, { kind: "config-show" });
  if (action === "reset") return noConfigArguments(rest, { kind: "config-reset" });
  if (action === "set") return parseConfigSet(rest);
  throw new Error("usage: pi-reviewer config <show|reset|set model VALUE|set thinking LEVEL>");
}

function parseConfigSet(args: readonly string[]): ParsedCommand {
  const [key, value, extra] = args;
  if (value === undefined || extra !== undefined) {
    throw new Error("usage: pi-reviewer config set <model VALUE|thinking LEVEL>");
  }
  if (key === "model") return { kind: "config-set-model", model: validateModel(value) };
  if (key === "thinking") return { kind: "config-set-thinking", thinking: validateThinking(value) };
  throw new Error("config key must be model or thinking");
}

function noConfigArguments<T extends ParsedCommand>(args: readonly string[], command: T): T {
  if (args.length > 0) throw new Error("config command received unexpected arguments");
  return command;
}

function parseLogin(args: readonly string[]): ParsedCommand {
  if (args.length > 1) throw new Error("usage: pi-reviewer login [provider]");
  const provider = args[0];
  return provider === undefined ? { kind: "login" } : { kind: "login", provider };
}

function parseModels(args: readonly string[]): ParsedCommand {
  if (args.length > 1) throw new Error("usage: pi-reviewer models [search]");
  const search = args[0];
  return search === undefined ? { kind: "models" } : { kind: "models", search };
}

function parseReview(args: readonly string[], cwd: string): ReviewRequest {
  const fields: ReviewFields = { cwd, custom: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = required(args[index], "missing argument");
    index += consumeReviewArg(fields, arg, args[index + 1]);
  }
  return finalizeReviewFields(fields);
}

function finalizeReviewFields(fields: ReviewFields): ReviewRequest {
  const custom = fields.custom.join(" ").trim();
  if (custom.length > MAX_INPUT_CHARS) throw new Error("custom review instructions are too long");
  if (custom !== "") setTarget(fields, { kind: "custom", instructions: custom });
  if (fields.target === undefined) throw new Error(reviewUsage());
  assertTitleTarget(fields);
  const request: {
    target: ReviewTarget;
    cwd: string;
    model?: string;
    thinking?: ThinkingLevel;
  } = { target: withCommitTitle(fields.target, fields.title), cwd: fields.cwd };
  if (fields.model !== undefined) request.model = fields.model;
  if (fields.thinking !== undefined) request.thinking = fields.thinking;
  return request;
}

function assertTitleTarget(fields: ReviewFields): void {
  if (fields.title !== undefined && fields.target?.kind !== "commit") {
    throw new Error("--title requires --commit");
  }
}

function consumeReviewArg(fields: ReviewFields, arg: string, next: string | undefined): number {
  const target = consumeTargetArg(fields, arg, next);
  if (target !== undefined) return target;
  const option = consumeReviewOption(fields, arg, next);
  if (option !== undefined) return option;
  if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
  fields.custom.push(arg);
  return 0;
}

function consumeTargetArg(
  fields: ReviewFields,
  arg: string,
  next: string | undefined,
): number | undefined {
  if (arg === "--uncommitted") {
    setTarget(fields, { kind: "uncommitted" });
    return 0;
  }
  if (arg === "--base") {
    setTarget(fields, { kind: "base", branch: requiredValue(next, arg) });
    return 1;
  }
  if (arg === "--commit") {
    setTarget(fields, { kind: "commit", sha: requiredValue(next, arg) });
    return 1;
  }
  return undefined;
}

function consumeReviewOption(
  fields: ReviewFields,
  arg: string,
  next: string | undefined,
): number | undefined {
  if (arg === "--title") fields.title = requiredValue(next, arg);
  else if (arg === "--model") fields.model = validateModel(requiredValue(next, arg));
  else if (arg === "--thinking") fields.thinking = validateThinking(requiredValue(next, arg));
  else if (arg === "--cwd") fields.cwd = requiredValue(next, arg);
  else return undefined;
  return 1;
}

function setTarget(fields: ReviewFields, target: ReviewTarget): void {
  if (fields.target !== undefined) throw new Error("review targets are mutually exclusive");
  fields.target = target;
}

function withCommitTitle(target: ReviewTarget, title: string | undefined): ReviewTarget {
  if (target.kind !== "commit" || title === undefined) return target;
  return { ...target, title };
}

export function parseModel(value: string): { provider: string; model: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("model must use provider/model format");
  }
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
}

export function validateModel(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length > 512) throw new Error("invalid model value");
  parseModel(trimmed);
  return trimmed;
}

export function validateThinking(value: string): ThinkingLevel {
  if (THINKING_LEVELS.some((level) => level === value)) return value as ThinkingLevel;
  throw new Error(`thinking must be one of ${THINKING_LEVELS.join(", ")}`);
}

function requiredValue(value: string | undefined, option: string): string {
  return required(value, `${option} requires a value`);
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

export function reviewUsage(): string {
  return "usage: pi-reviewer (--uncommitted | --base BRANCH | --commit SHA | INSTRUCTIONS) [--model PROVIDER/MODEL] [--thinking LEVEL] [--cwd DIR]";
}
