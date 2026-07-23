import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatQueryErrors, showReport } from "./format.js";
import { isStaleExtensionContextError } from "./query.js";
import { createUsageService, type UsageService } from "./usage-service.js";
import { createWeeklyStatusController } from "./weekly-status.js";
import type { CodexUsageReport, QueryUsageOptions, UsageQueryContext } from "./types.js";

const COMMAND_NAME = "codex-status";
const DEFAULT_TIMEOUT_MS = 15_000;

type CommandArgumentCompletion = {
  value: string;
  label: string;
  description?: string;
};

type UsageCommandContext = UsageQueryContext & {
  hasUI: boolean;
  ui: Pick<ExtensionCommandContext["ui"], "notify" | "setStatus">;
};

type CodexStatusCommand = {
  description: string;
  getArgumentCompletions: typeof completeCodexStatusArguments;
  handler: (args: string, ctx: UsageCommandContext) => Promise<void>;
};

type CodexUsageRegistrar = {
  registerCommand: (name: string, command: CodexStatusCommand) => void;
};

type ReportObserver = (ctx: UsageCommandContext, report: CodexUsageReport) => void;

const COMMAND_COMPLETIONS: readonly CommandArgumentCompletion[] = [
  { value: "--refresh", label: "--refresh", description: "Refresh usage instead of cached data" },
  { value: "--timeout ", label: "--timeout", description: "Set query timeout in seconds" },
];

export function createCodexStatusHandler(
  service: UsageService = createUsageService(),
  onReport?: ReportObserver,
): (args: string, ctx: UsageCommandContext) => Promise<void> {
  return async (args, ctx) => {
    try {
      const options = parseArgs(args);
      if (!options.ok) {
        ctx.ui.notify(options.error, "warning");
        return;
      }

      const result = await service.read(ctx, options.value);
      if (!result.ok) {
        ctx.ui.notify(formatQueryErrors(result.errors), "error");
        return;
      }

      onReport?.(ctx, result.report);
      showReport(ctx, result.report);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  };
}

export function registerCodexUsage(
  pi: CodexUsageRegistrar,
  handler = createCodexStatusHandler(),
): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Show Codex ChatGPT subscription usage and rate-limit windows",
    getArgumentCompletions: completeCodexStatusArguments,
    handler,
  });
}

export default function codexUsage(pi: ExtensionAPI): void {
  const service = createUsageService();
  const weeklyStatus = createWeeklyStatusController(service);
  registerCodexUsage(pi, createCodexStatusHandler(service, weeklyStatus.publish));

  pi.on("session_start", (_event, ctx) => weeklyStatus.sync(ctx));
  pi.on("model_select", (event, ctx) => weeklyStatus.sync(ctx, event.model));
  pi.on("agent_settled", (_event, ctx) => weeklyStatus.sync(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    weeklyStatus.clear(ctx);
  });
}

export function completeCodexStatusArguments(
  argumentPrefix: string,
): CommandArgumentCompletion[] | null {
  const prefix = argumentPrefix.trimStart();
  if (prefix === "") return [...COMMAND_COMPLETIONS];

  const state = completionState(prefix);
  if (!state) return null;
  const matches = COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(state.current));
  return matches.length > 0
    ? matches.map((item) => ({ ...item, value: `${state.prefix}${item.value}` }))
    : null;
}

type CompletionState = { current: string; prefix: string };

function completionState(prefix: string): CompletionState | undefined {
  const trailingSpace = /\s$/.test(prefix);
  const tokens = prefix.trimEnd().split(/\s+/).filter(Boolean);
  if (expectsTimeoutValue(tokens, trailingSpace)) return undefined;
  return buildCompletionState(prefix, tokens.at(-1), trailingSpace);
}

function expectsTimeoutValue(tokens: string[], trailingSpace: boolean): boolean {
  return trailingSpace ? tokens.at(-1) === "--timeout" : tokens.at(-2) === "--timeout";
}

function buildCompletionState(
  prefix: string,
  previous: string | undefined,
  trailingSpace: boolean,
): CompletionState | undefined {
  const current = completionCurrent(previous, trailingSpace);
  if (current !== "" && !current.startsWith("-")) return undefined;
  return { current, prefix: completionPrefix(prefix, trailingSpace) };
}

function completionCurrent(previous: string | undefined, trailingSpace: boolean): string {
  if (trailingSpace) return "";
  return previous ?? "";
}

function completionPrefix(prefix: string, trailingSpace: boolean): string {
  if (trailingSpace) return prefix;
  const match = /\S+$/.exec(prefix);
  if (!match) return prefix;
  return prefix.slice(0, prefix.length - match[0].length);
}

type ParsedOption =
  | { ok: true; kind: "refresh" }
  | { ok: true; kind: "timeout"; timeoutMs: number }
  | { ok: false; error: string };

export function parseArgs(
  args: string,
): { ok: true; value: QueryUsageOptions } | { ok: false; error: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let refresh = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < tokens.length; index += 1) {
    const option = parseOption(tokens, index);
    if (!option.ok) return option;
    if (option.kind === "refresh") {
      refresh = true;
    } else {
      timeoutMs = option.timeoutMs;
      index += 1;
    }
  }

  return { ok: true, value: { refresh, timeoutMs } };
}

function parseOption(tokens: string[], index: number): ParsedOption {
  const token = tokens[index];
  if (token === undefined) return invalidUsage();
  if (token === "--refresh") return { ok: true, kind: "refresh" };
  if (token !== "--timeout") {
    return { ok: false, error: `Unknown option: ${token}. ${usageText()}` };
  }

  const rawValue = tokens[index + 1];
  if (!rawValue) return invalidUsage();
  const timeoutMs = parseTimeoutMilliseconds(rawValue);
  return timeoutMs === undefined
    ? { ok: false, error: "--timeout must be a number of seconds between 1 and 120." }
    : { ok: true, kind: "timeout", timeoutMs };
}

function parseTimeoutMilliseconds(rawValue: string): number | undefined {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed <= 0) return undefined;
  if (parsed > 120) return undefined;
  return Math.round(parsed * 1000);
}

function invalidUsage(): { ok: false; error: string } {
  return { ok: false, error: usageText() };
}

function usageText(): string {
  return "Usage: /codex-status [--refresh] [--timeout seconds]";
}

export { formatCodexUsageReport } from "./format.js";
export { normalizeAppServerResponse, normalizeBackendPayload } from "./normalize.js";
export { isStaleExtensionContextError } from "./query.js";
export { createUsageService, USAGE_CACHE_TTL_MS, type UsageService } from "./usage-service.js";
export {
  CODEX_PROVIDER_ID,
  CODEX_WEEKLY_STATUS_ID,
  createWeeklyStatusController,
  formatWeeklyRemaining,
  isCodexModel,
  type WeeklyStatusController,
} from "./weekly-status.js";
export type {
  CodexUsageReport,
  NormalizedCredits,
  NormalizedRateLimitResetCredit,
  NormalizedRateLimitResetCredits,
  NormalizedRateLimitSnapshot,
  NormalizedRateLimitWindow,
} from "./types.js";
