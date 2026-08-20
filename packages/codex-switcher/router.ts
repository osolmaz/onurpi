import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type AuthResult,
  type Context,
  type Model,
  type ProviderHeaders,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { UsageReport } from "@onurpi/pi-usage";

import {
  assertOfficialCodexEndpoint,
  mapCodexEventProvider,
  toBuiltInCodexContext,
  toBuiltInCodexModel,
} from "./codex-family.ts";
import type { CodexProfile } from "./config.ts";
import { usageDecision } from "./usage-policy.ts";

type CodexModel = Model<"openai-codex-responses">;

export type ProfileUsageState =
  | { status: "unknown" }
  | { status: "ready"; report: UsageReport }
  | { status: "failed"; message: string };

export type SwitcherState = {
  activeProfileId?: string;
  agentRunActive: boolean;
  runProfileId: string | undefined;
  usageByProfile: Map<string, ProfileUsageState>;
};

export type SwitcherRuntime = {
  getAuth(providerId: string): Promise<AuthResult | undefined>;
  queryUsage(
    profile: CodexProfile,
    auth: AuthResult["auth"],
    model: CodexModel,
    signal: AbortSignal,
  ): Promise<UsageReport | undefined>;
  clearUsage(profile: CodexProfile): void;
  activateProfile(profile: CodexProfile, model: CodexModel): Promise<void>;
};

export type CodexTransport = (
  model: CodexModel,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export type RouterOptions = {
  profiles: readonly CodexProfile[];
  fallbackChain: readonly string[];
  runtime: SwitcherRuntime;
  state: SwitcherState;
  transport: CodexTransport;
};

type Candidate = {
  profile: CodexProfile;
  model: CodexModel;
  auth: AuthResult["auth"];
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

function profileMap(profiles: readonly CodexProfile[]): Map<string, CodexProfile> {
  return new Map(profiles.map((profile) => [profile.id, profile]));
}

function candidatesFrom(
  selectedProvider: string,
  profiles: readonly CodexProfile[],
  fallbackChain: readonly string[],
  runProfileId: string | undefined,
): CodexProfile[] {
  const byId = profileMap(profiles);
  const selected =
    runProfileId ?? profiles.find((profile) => profile.providerId === selectedProvider)?.id;
  const start = selected ? fallbackChain.indexOf(selected) : -1;
  if (start < 0) return [];
  return fallbackChain.slice(start).flatMap((id) => {
    const profile = byId.get(id);
    return profile ? [profile] : [];
  });
}

function activeRunProfile(state: SwitcherState): string | undefined {
  return state.agentRunActive ? state.runProfileId : undefined;
}

function withoutCredentialHeaders(headers: ProviderHeaders | undefined): ProviderHeaders {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([name]) => !["authorization", "chatgpt-account-id"].includes(name.toLowerCase()),
    ),
  );
}

function requestOptions(
  options: StreamOptions | undefined,
  auth: AuthResult["auth"],
): StreamOptions {
  return {
    ...options,
    ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
    headers: { ...withoutCredentialHeaders(options?.headers), ...auth.headers },
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

async function eligibleCandidate(
  profile: CodexProfile,
  selectedModel: CodexModel,
  options: RouterOptions,
  signal: AbortSignal,
): Promise<Candidate | undefined> {
  assertOfficialCodexEndpoint(selectedModel);
  const auth = await options.runtime.getAuth(profile.providerId);
  if (!auth?.auth.apiKey) return undefined;
  const model = { ...selectedModel, provider: profile.providerId };
  try {
    const report = await options.runtime.queryUsage(profile, auth.auth, model, signal);
    if (report) {
      options.state.usageByProfile.set(profile.id, { status: "ready", report });
      if (usageDecision(report, model.id, profile.billing) === "exhausted") return undefined;
    }
  } catch (error) {
    options.state.usageByProfile.set(profile.id, {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return { profile, model, auth: auth.auth };
}

function commitCandidate(candidate: Candidate, options: RouterOptions): void {
  options.state.activeProfileId = candidate.profile.id;
  if (options.state.agentRunActive) options.state.runProfileId = candidate.profile.id;
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

async function forwardTerminal(
  event: AssistantMessageEvent,
  candidate: Candidate,
  output: AssistantMessageEventStream,
  options: RouterOptions,
): Promise<AttemptResult | undefined> {
  if (event.type === "done") {
    await options.runtime.activateProfile(candidate.profile, candidate.model);
    output.push(event);
    return { status: "success" };
  }
  output.push(event);
  return event.type === "error" ? { status: "terminal" } : undefined;
}

async function attemptCandidate(
  candidate: Candidate,
  context: Context,
  streamOptions: StreamOptions | undefined,
  output: AssistantMessageEventStream,
  options: RouterOptions,
): Promise<AttemptResult> {
  const stream = options.transport(
    toBuiltInCodexModel(candidate.model),
    toBuiltInCodexContext(context),
    requestOptions(streamOptions, candidate.auth),
  );
  const buffered: AssistantMessageEvent[] = [];
  let committed = false;
  for await (const raw of stream) {
    const event = mapCodexEventProvider(raw, candidate.profile.providerId);
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
    const terminal = await forwardTerminal(event, candidate, output, options);
    if (terminal) return terminal;
  }
  flushBuffered(buffered, output);
  output.push(
    routingError(candidate.model, "Codex provider stream ended without a terminal event."),
  );
  return { status: "terminal" };
}

function routeFailureMessage(signal: AbortSignal): string {
  return signal.aborted
    ? "Codex profile routing was aborted."
    : "No authenticated Codex profile with available usage remains in the fallback chain.";
}

function isUsageLimitResult(
  result: AttemptResult,
): result is Extract<AttemptResult, { status: "usage-limit" }> {
  return result.status === "usage-limit";
}

async function route(
  model: CodexModel,
  context: Context,
  streamOptions: StreamOptions | undefined,
  output: AssistantMessageEventStream,
  options: RouterOptions,
): Promise<void> {
  const profiles = candidatesFrom(
    model.provider,
    options.profiles,
    options.fallbackChain,
    activeRunProfile(options.state),
  );
  const signal = streamOptions?.signal ?? new AbortController().signal;
  let lastLimit: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
  for (const profile of profiles) {
    if (signal.aborted) break;
    const candidate = await eligibleCandidate(profile, model, options, signal);
    if (!candidate) continue;
    const result = await attemptCandidate(candidate, context, streamOptions, output, options);
    if (!isUsageLimitResult(result)) return;
    options.runtime.clearUsage(profile);
    options.state.usageByProfile.set(profile.id, { status: "unknown" });
    lastLimit = result.event;
  }
  output.push(lastLimit ?? routingError(model, routeFailureMessage(signal)));
}

export function createCodexSwitcherStream(options: RouterOptions): CodexTransport {
  return (model, context, streamOptions) => {
    const output = createAssistantMessageEventStream();
    void route(model, context, streamOptions, output, options).catch((error: unknown) => {
      output.push(routingError(model, error instanceof Error ? error.message : String(error)));
    });
    return output;
  };
}
