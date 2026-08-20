import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelAuth,
  type ProviderHeaders,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { UsageReport } from "@onurpi/pi-usage";

import type { CodexAccount } from "./config.ts";
import { usageDecision } from "./usage-policy.ts";

type CodexModel = Model<"openai-codex-responses">;

export type AccountUsageState =
  | { status: "unknown" }
  | { status: "ready"; report: UsageReport }
  | { status: "failed"; message: string };

export type SwitcherState = {
  activeAccountId: string | undefined;
  agentRunActive: boolean;
  leaseAccountId: string | undefined;
  usageByAccount: Map<string, AccountUsageState>;
};

export type SwitcherRuntime = {
  activateAccount(account: CodexAccount): void;
  clearUsage(account: CodexAccount): void;
  getAuth(accountId: string, signal: AbortSignal): Promise<ModelAuth | undefined>;
  queryUsage(
    account: CodexAccount,
    auth: ModelAuth,
    model: CodexModel,
    signal: AbortSignal,
  ): Promise<UsageReport | undefined>;
};

export type CodexTransport = (
  model: CodexModel,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export type RouterOptions = {
  getAccounts(): readonly CodexAccount[];
  runtime: SwitcherRuntime;
  state: SwitcherState;
  transport: CodexTransport;
};

type Candidate = {
  account: CodexAccount;
  auth: ModelAuth;
};

type AttemptResult =
  | { status: "success" }
  | { status: "terminal" }
  | { status: "usage-limit"; event: Extract<AssistantMessageEvent, { type: "error" }> };

type PrecommitAction =
  | { status: "buffer" }
  | { status: "commit" }
  | { status: "usage-limit"; event: Extract<AssistantMessageEvent, { type: "error" }> };

const USAGE_LIMIT_ERROR =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|\busage limit(?: reached| exceeded)?\b|\binsufficient_quota\b|\bquota exceeded\b|\bout of budget\b|\binsufficient (?:credit|balance)\b|\bno available balance\b|\bavailable balance is (?:too low|exhausted|zero)\b|\bcredit balance (?:is )?(?:exhausted|insufficient|zero)\b|\bbilling_hard_limit_reached\b/iu;

function officialCodexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://chatgpt.com" &&
      url.pathname.replace(/\/+$/u, "") === "/backend-api" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function assertOfficialCodexModel(model: CodexModel): void {
  if (model.provider === "openai-codex" && officialCodexUrl(model.baseUrl)) return;
  throw new Error("Codex account authentication is restricted to the official endpoint.");
}

function withoutCredentialHeaders(headers: ProviderHeaders | undefined): ProviderHeaders {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([name]) => !["authorization", "chatgpt-account-id"].includes(name.toLowerCase()),
    ),
  );
}

function requestOptions(options: StreamOptions | undefined, auth: ModelAuth): StreamOptions {
  const { apiKey: discardedApiKey, headers: originalHeaders, ...rest } = options ?? {};
  void discardedApiKey;
  return {
    ...rest,
    ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
    headers: { ...withoutCredentialHeaders(originalHeaders), ...auth.headers },
  };
}

function errorMessage(message: AssistantMessage): string {
  return message.errorMessage ?? "";
}

export function isTerminalUsageLimit(message: AssistantMessage): boolean {
  return message.stopReason === "error" && USAGE_LIMIT_ERROR.test(errorMessage(message));
}

function zeroUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function routingError(model: CodexModel, message: string): AssistantMessageEvent {
  return {
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: zeroUsage(),
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    },
  };
}

function accountCandidates(options: RouterOptions): readonly CodexAccount[] {
  const lease = options.state.agentRunActive ? options.state.leaseAccountId : undefined;
  if (!lease) return options.getAccounts();
  const account = options.getAccounts().find((candidate) => candidate.id === lease);
  return account ? [account] : [];
}

async function resolveAccountAuth(
  account: CodexAccount,
  options: RouterOptions,
  signal: AbortSignal,
): Promise<ModelAuth | undefined> {
  try {
    return await options.runtime.getAuth(account.id, signal);
  } catch {
    throw new Error("Codex account authentication failed.");
  }
}

async function hasPermittedUsage(
  account: CodexAccount,
  auth: ModelAuth,
  model: CodexModel,
  options: RouterOptions,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const report = await options.runtime.queryUsage(account, auth, model, signal);
    if (!report) return true;
    options.state.usageByAccount.set(account.id, { status: "ready", report });
    return usageDecision(report, model.id, account.billing) !== "exhausted";
  } catch {
    options.state.usageByAccount.set(account.id, {
      status: "failed",
      message: "usage check unavailable",
    });
    return true;
  }
}

async function eligibleCandidate(
  account: CodexAccount,
  model: CodexModel,
  options: RouterOptions,
  signal: AbortSignal,
): Promise<Candidate | undefined> {
  assertOfficialCodexModel(model);
  const auth = await resolveAccountAuth(account, options, signal);
  if (!auth?.apiKey && !auth?.headers) return undefined;
  return (await hasPermittedUsage(account, auth, model, options, signal))
    ? { account, auth }
    : undefined;
}

function commitCandidate(candidate: Candidate, options: RouterOptions): void {
  options.state.activeAccountId = candidate.account.id;
  if (options.state.agentRunActive) options.state.leaseAccountId = candidate.account.id;
  options.runtime.activateAccount(candidate.account);
}

function flushBuffered(
  buffered: readonly AssistantMessageEvent[],
  output: AssistantMessageEventStream,
): void {
  for (const pending of buffered) output.push(pending);
}

function precommitAction(event: AssistantMessageEvent): PrecommitAction {
  if (event.type === "start") return { status: "buffer" };
  if (event.type === "error" && isTerminalUsageLimit(event.error)) {
    return { status: "usage-limit", event };
  }
  return { status: "commit" };
}

async function attemptCandidate(
  candidate: Candidate,
  model: CodexModel,
  context: Context,
  streamOptions: StreamOptions | undefined,
  output: AssistantMessageEventStream,
  options: RouterOptions,
): Promise<AttemptResult> {
  const requestModel = candidate.auth.baseUrl
    ? { ...model, baseUrl: candidate.auth.baseUrl }
    : model;
  const stream = options.transport(
    requestModel,
    context,
    requestOptions(streamOptions, candidate.auth),
  );
  const buffered: AssistantMessageEvent[] = [];
  let committed = false;
  for await (const event of stream) {
    if (!committed) {
      const action = precommitAction(event);
      if (action.status === "buffer") {
        buffered.push(event);
        continue;
      }
      if (action.status === "usage-limit") return action;
      committed = true;
      commitCandidate(candidate, options);
      flushBuffered(buffered, output);
    }
    output.push(event);
    if (event.type === "done") return { status: "success" };
    if (event.type === "error") return { status: "terminal" };
  }
  flushBuffered(buffered, output);
  output.push(routingError(model, "Codex provider stream ended without a terminal event."));
  return { status: "terminal" };
}

function routeFailureMessage(signal: AbortSignal): string {
  return signal.aborted
    ? "Codex account routing was aborted."
    : "No authenticated Codex account with available usage remains.";
}

type RouteAccountResult =
  | { status: "done" }
  | { status: "continue"; limit?: Extract<AssistantMessageEvent, { type: "error" }> };

async function routeAccount(
  account: CodexAccount,
  model: CodexModel,
  context: Context,
  streamOptions: StreamOptions | undefined,
  output: AssistantMessageEventStream,
  options: RouterOptions,
  signal: AbortSignal,
): Promise<RouteAccountResult> {
  const candidate = await eligibleCandidate(account, model, options, signal);
  if (!candidate) return { status: "continue" };
  const result = await attemptCandidate(candidate, model, context, streamOptions, output, options);
  if (result.status !== "usage-limit") return { status: "done" };
  options.runtime.clearUsage(account);
  options.state.usageByAccount.set(account.id, { status: "unknown" });
  return { status: "continue", limit: result.event };
}

function requestSignal(streamOptions: StreamOptions | undefined): AbortSignal {
  return streamOptions?.signal ?? new AbortController().signal;
}

function hasCommittedLease(state: SwitcherState): boolean {
  return state.agentRunActive && state.leaseAccountId !== undefined;
}

async function route(
  model: CodexModel,
  context: Context,
  streamOptions: StreamOptions | undefined,
  output: AssistantMessageEventStream,
  options: RouterOptions,
): Promise<void> {
  const signal = requestSignal(streamOptions);
  const leased = hasCommittedLease(options.state);
  let lastLimit: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
  for (const account of accountCandidates(options)) {
    if (signal.aborted) break;
    const result = await routeAccount(
      account,
      model,
      context,
      streamOptions,
      output,
      options,
      signal,
    );
    if (result.status === "done") return;
    if (result.limit) lastLimit = result.limit;
    if (leased) break;
  }
  output.push(lastLimit ?? routingError(model, routeFailureMessage(signal)));
}

export function createCodexSwitcherStream(options: RouterOptions): CodexTransport {
  return (model, context, streamOptions) => {
    const output = createAssistantMessageEventStream();
    void route(model, context, streamOptions, output, options).catch(() => {
      output.push(routingError(model, "Codex account routing failed."));
    });
    return output;
  };
}
