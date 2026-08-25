import { randomUUID } from "node:crypto";

import type {
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  CompactionResult,
  ContextEvent,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

import { loadConfig, type CodexCompactionConfig } from "./config.ts";
import {
  findNativeCheckpoint,
  isJsonObject,
  isOpenAICodexModel,
  modelKey,
  NATIVE_COMPACTION_KIND,
  NATIVE_COMPACTION_VERSION,
  type CodexModel,
  type JsonObject,
  type NativeCompactionDetails,
  type ResponseItem,
} from "./native-checkpoint.ts";
import {
  buildCodexHeaders,
  callRemoteCompaction,
  mergeFeatureHeader,
  resolveCodexResponsesUrl,
} from "./remote-compaction.ts";
import {
  buildCompactionRequestBody,
  buildReplacementHistory,
  buildToolPayload,
  effectiveInputForBranch,
  stripInputFromPayload,
} from "./responses-input.ts";

export const COMPACTION_STATUS_KIND = "openai-codex-compaction-status";
export const CONTINUATION_MESSAGE_KIND = "onurpi-codex-compaction-continuation";
export const CONTINUATION_PROMPT = "Compaction completed. Continue.";
export const FORCED_COMPACTION_DISPLAY_EVENT =
  "@onurpi/pi-codex-compaction:forced-compaction-display";

export type CompactionStatus = {
  state: "running" | "complete" | "failed";
  error?: string;
};

export type ForcedCompactionDisplayEvent = {
  action: "hold" | "release";
  sessionId: string;
};

type ContinuationMessage = {
  customType: typeof CONTINUATION_MESSAGE_KIND;
  content: typeof CONTINUATION_PROMPT;
  display: false;
};

type CachedPayloadShape = {
  modelKey: string;
  payload: JsonObject;
};

type ForcedCompactionState = {
  sessionId: string;
  phase: "waitingForSettle" | "compacting" | "compacted";
};

/** Minimal context surface the controller needs; `ExtensionContext` satisfies it. */
export type CodexCompactionContext = Pick<
  ExtensionContext,
  | "model"
  | "mode"
  | "cwd"
  | "hasUI"
  | "abort"
  | "compact"
  | "isProjectTrusted"
  | "hasPendingMessages"
  | "getContextUsage"
  | "getSystemPrompt"
> & {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId" | "getBranch">;
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "getApiKeyAndHeaders">;
  ui: Pick<ExtensionContext["ui"], "notify">;
};

type ContextHookResult = { messages?: ContextEvent["messages"] } | undefined;

type CompactionHookResult =
  | { cancel?: boolean; compaction?: CompactionResult<NativeCompactionDetails> }
  | undefined;

export type CodexCompactionApi = {
  onSessionStart(handler: () => void): void;
  onSessionShutdown(handler: () => void): void;
  onModelSelect(handler: (ctx: CodexCompactionContext) => void): void;
  onContext(handler: (event: ContextEvent, ctx: CodexCompactionContext) => ContextHookResult): void;
  onBeforeProviderHeaders(
    handler: (event: BeforeProviderHeadersEvent, ctx: CodexCompactionContext) => void,
  ): void;
  onBeforeProviderRequest(
    handler: (event: BeforeProviderRequestEvent, ctx: CodexCompactionContext) => unknown,
  ): void;
  onSessionBeforeCompact(
    handler: (
      event: SessionBeforeCompactEvent,
      ctx: CodexCompactionContext,
    ) => Promise<CompactionHookResult>,
  ): void;
  onTurnEnd(handler: (ctx: CodexCompactionContext) => void): void;
  onSessionCompact(
    handler: (event: SessionCompactEvent, ctx: CodexCompactionContext) => void,
  ): void;
  onAgentSettled(handler: (ctx: CodexCompactionContext) => void): void;
  appendEntry(customType: string, data: CompactionStatus): void;
  emitForcedCompactionDisplay(event: ForcedCompactionDisplayEvent): void;
  sendMessage(
    message: ContinuationMessage,
    options: { deliverAs: "followUp"; triggerTurn: true },
  ): void;
  getAllTools(): ToolInfo[];
  getActiveTools(): string[];
};

type ControllerState = {
  payloadShapeBySession: Map<string, CachedPayloadShape>;
  forcedCompaction: ForcedCompactionState | undefined;
};

type ControllerDeps = {
  api: CodexCompactionApi;
  readConfig: (cwd: string, projectTrusted: boolean) => CodexCompactionConfig;
  createCheckpoint: (params: CheckpointParams) => Promise<CheckpointResult>;
  marker: () => string;
};

type CheckpointParams = {
  ctx: CodexCompactionContext;
  model: CodexModel;
  input: ResponseItem[];
  tools?: ResponseItem[];
  basePayload?: JsonObject;
  signal?: AbortSignal;
};

type CheckpointResult = {
  details: NativeCompactionDetails;
  usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"];
};

function localMarker(): string {
  return `OpenAI Codex native compaction checkpoint (${randomUUID()}).`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setFeatureHeader(headers: BeforeProviderHeadersEvent["headers"]): void {
  const existing = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "x-codex-beta-features",
  );
  if (existing) {
    headers[existing[0]] = mergeFeatureHeader(existing[1]);
  } else {
    headers["x-codex-beta-features"] = mergeFeatureHeader(undefined);
  }
}

async function resolveCodexAuth(
  ctx: CodexCompactionContext,
  model: CodexModel,
): Promise<{ apiKey: string; headers: BeforeProviderHeadersEvent["headers"] }> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  if (!auth.apiKey) throw new Error("OpenAI Codex authentication is unavailable.");
  return { apiKey: auth.apiKey, headers: auth.headers ?? {} };
}

async function createNativeCheckpoint(params: CheckpointParams): Promise<CheckpointResult> {
  const auth = await resolveCodexAuth(params.ctx, params.model);
  const sessionId = params.ctx.sessionManager.getSessionId();
  const body = buildCompactionRequestBody({
    ...(params.basePayload ? { basePayload: params.basePayload } : {}),
    model: params.model,
    input: params.input,
    instructions: params.ctx.getSystemPrompt(),
    ...(params.tools ? { tools: params.tools } : {}),
    sessionId,
  });
  const remote = await callRemoteCompaction({
    url: resolveCodexResponsesUrl(params.model.baseUrl),
    headers: buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }),
    body,
    model: params.model,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  return {
    details: {
      kind: NATIVE_COMPACTION_KIND,
      version: NATIVE_COMPACTION_VERSION,
      modelKey: modelKey(params.model),
      replacementHistory: buildReplacementHistory(params.input, remote.compactionItem),
    },
    ...(remote.usage ? { usage: remote.usage } : {}),
  };
}

function appendCompactionStatus(
  api: CodexCompactionApi,
  ctx: CodexCompactionContext,
  status: CompactionStatus,
): void {
  if (ctx.mode === "tui") api.appendEntry(COMPACTION_STATUS_KIND, status);
}

async function withCompactionStatus<T>(
  deps: ControllerDeps,
  ctx: CodexCompactionContext,
  operation: () => Promise<T>,
): Promise<T> {
  appendCompactionStatus(deps.api, ctx, { state: "running" });
  try {
    const result = await operation();
    appendCompactionStatus(deps.api, ctx, { state: "complete" });
    return result;
  } catch (error) {
    appendCompactionStatus(deps.api, ctx, { state: "failed", error: errorMessage(error) });
    throw error;
  }
}

function handleContext(event: ContextEvent, ctx: CodexCompactionContext): ContextHookResult {
  const checkpoint = findNativeCheckpoint(ctx.sessionManager.getBranch());
  if (checkpoint.status === "none") return undefined;
  return {
    messages: event.messages.filter((message) => message.role !== "compactionSummary"),
  };
}

function handleBeforeProviderRequest(
  deps: ControllerDeps,
  state: ControllerState,
  event: BeforeProviderRequestEvent,
  ctx: CodexCompactionContext,
): unknown {
  const model = ctx.model;
  if (!isOpenAICodexModel(model) || !isJsonObject(event.payload)) return undefined;

  const sessionId = ctx.sessionManager.getSessionId();
  state.payloadShapeBySession.set(sessionId, {
    modelKey: modelKey(model),
    payload: stripInputFromPayload(event.payload),
  });

  const branch = ctx.sessionManager.getBranch();
  const checkpoint = findNativeCheckpoint(branch);
  try {
    if (checkpoint.status === "none") return undefined;
    const input = effectiveInputForBranch({ branch, model, tools: deps.api.getAllTools() });
    return { ...omitEnvelope(event.payload), input };
  } catch (error) {
    ctx.abort();
    if (ctx.hasUI) {
      ctx.ui.notify(`OpenAI Codex request blocked: ${errorMessage(error)}`, "error");
    }
    return { ...omitEnvelope(event.payload), input: [] };
  }
}

function omitEnvelope(payload: JsonObject): JsonObject {
  const excluded = new Set(["messages", "previous_response_id"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !excluded.has(key)));
}

function checkpointParams(
  deps: ControllerDeps,
  state: ControllerState,
  event: SessionBeforeCompactEvent,
  ctx: CodexCompactionContext,
  model: CodexModel,
): CheckpointParams {
  const sessionId = ctx.sessionManager.getSessionId();
  const input = effectiveInputForBranch({
    branch: event.branchEntries,
    model,
    tools: deps.api.getAllTools(),
    excludeLastAssistantError: event.reason === "overflow" && event.willRetry,
  });
  const cached = state.payloadShapeBySession.get(sessionId);
  const tools = buildToolPayload(deps.api.getAllTools(), deps.api.getActiveTools());
  return {
    ctx,
    model,
    input,
    ...(tools ? { tools } : {}),
    ...(cached?.modelKey === modelKey(model) ? { basePayload: cached.payload } : {}),
    signal: event.signal,
  };
}

function abandonCompaction(
  state: ControllerState,
  event: SessionBeforeCompactEvent,
  ctx: CodexCompactionContext,
  error: unknown,
): { cancel: true } {
  if (state.forcedCompaction?.sessionId === ctx.sessionManager.getSessionId()) {
    state.forcedCompaction = undefined;
  }
  if (!event.signal.aborted && ctx.hasUI) {
    ctx.ui.notify(`OpenAI Codex native compaction failed: ${errorMessage(error)}`, "error");
  }
  return { cancel: true };
}

async function handleSessionBeforeCompact(
  deps: ControllerDeps,
  state: ControllerState,
  event: SessionBeforeCompactEvent,
  ctx: CodexCompactionContext,
): Promise<CompactionHookResult> {
  const model = ctx.model;
  if (!isOpenAICodexModel(model)) return undefined;

  try {
    const native = await withCompactionStatus(deps, ctx, () =>
      deps.createCheckpoint(checkpointParams(deps, state, event, ctx, model)),
    );
    return {
      compaction: {
        summary: deps.marker(),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        ...(native.usage ? { usage: native.usage } : {}),
        details: native.details,
      },
    };
  } catch (error) {
    return abandonCompaction(state, event, ctx, error);
  }
}

function thresholdPercent(
  deps: ControllerDeps,
  state: ControllerState,
  ctx: CodexCompactionContext,
): number | undefined {
  if (state.forcedCompaction) return undefined;
  if (!isOpenAICodexModel(ctx.model)) return undefined;
  const config = deps.readConfig(ctx.cwd, ctx.isProjectTrusted());
  if (!config.autoCompact) return undefined;
  const percent = ctx.getContextUsage()?.percent;
  if (percent === null || percent === undefined) return undefined;
  return percent >= config.thresholdRatio * 100 ? percent : undefined;
}

function handleTurnEnd(
  deps: ControllerDeps,
  state: ControllerState,
  ctx: CodexCompactionContext,
): void {
  const percent = thresholdPercent(deps, state, ctx);
  if (percent === undefined) return;

  const sessionId = ctx.sessionManager.getSessionId();
  state.forcedCompaction = {
    sessionId,
    phase: "waitingForSettle",
  };
  deps.api.emitForcedCompactionDisplay({ action: "hold", sessionId });
  if (ctx.hasUI) {
    ctx.ui.notify(
      `OpenAI Codex context reached ${percent.toFixed(1)}%; stopping for compaction.`,
      "warning",
    );
  }
  ctx.abort();
}

function isOwnNativeCompaction(
  state: ForcedCompactionState | undefined,
  event: SessionCompactEvent,
  ctx: CodexCompactionContext,
): boolean {
  return (
    state?.phase === "waitingForSettle" &&
    state.sessionId === ctx.sessionManager.getSessionId() &&
    event.reason !== "manual" &&
    event.fromExtension &&
    isOpenAICodexModel(ctx.model) &&
    isJsonObject(event.compactionEntry.details) &&
    event.compactionEntry.details["kind"] === NATIVE_COMPACTION_KIND
  );
}

function handleSessionCompact(
  state: ControllerState,
  event: SessionCompactEvent,
  ctx: CodexCompactionContext,
): void {
  const forced = state.forcedCompaction;
  if (!isOwnNativeCompaction(forced, event, ctx)) return;
  if (event.willRetry) {
    state.forcedCompaction = undefined;
    return;
  }
  if (!forced) return;
  state.forcedCompaction = { sessionId: forced.sessionId, phase: "compacted" };
}

function releaseForcedCompactionDisplay(
  api: CodexCompactionApi,
  state: ControllerState,
  forced: ForcedCompactionState,
): void {
  if (state.forcedCompaction !== forced) return;
  state.forcedCompaction = undefined;
  api.emitForcedCompactionDisplay({ action: "release", sessionId: forced.sessionId });
}

function continueAfterCompaction(
  api: CodexCompactionApi,
  state: ControllerState,
  ctx: CodexCompactionContext,
  expected: ForcedCompactionState,
): void {
  if (state.forcedCompaction !== expected) return;
  if (ctx.hasPendingMessages()) {
    releaseForcedCompactionDisplay(api, state, expected);
    return;
  }

  state.forcedCompaction = undefined;
  try {
    api.sendMessage(
      {
        customType: CONTINUATION_MESSAGE_KIND,
        content: CONTINUATION_PROMPT,
        display: false,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  } catch (error) {
    api.emitForcedCompactionDisplay({ action: "release", sessionId: expected.sessionId });
    if (ctx.hasUI) {
      ctx.ui.notify(`OpenAI Codex continuation failed: ${errorMessage(error)}`, "error");
    }
  }
}

function handleAgentSettled(
  deps: ControllerDeps,
  state: ControllerState,
  ctx: CodexCompactionContext,
): void {
  const forced = state.forcedCompaction;
  if (forced?.sessionId !== ctx.sessionManager.getSessionId()) return;
  if (!isOpenAICodexModel(ctx.model)) return;
  if (forced.phase === "compacted") {
    continueAfterCompaction(deps.api, state, ctx, forced);
    return;
  }
  if (forced.phase !== "waitingForSettle") return;

  const compacting: ForcedCompactionState = { ...forced, phase: "compacting" };
  state.forcedCompaction = compacting;
  ctx.compact({
    onComplete: () => {
      continueAfterCompaction(deps.api, state, ctx, compacting);
    },
    onError: (error) => {
      if (state.forcedCompaction !== compacting) return;
      releaseForcedCompactionDisplay(deps.api, state, compacting);
      if (!ctx.hasUI) return;
      ctx.ui.notify(`OpenAI Codex compaction failed: ${error.message}`, "error");
    },
  });
}

export function installCodexCompaction(
  api: CodexCompactionApi,
  overrides: Partial<Pick<ControllerDeps, "readConfig" | "createCheckpoint" | "marker">> = {},
): void {
  const state: ControllerState = {
    payloadShapeBySession: new Map(),
    forcedCompaction: undefined,
  };
  const deps: ControllerDeps = {
    api,
    readConfig: overrides.readConfig ?? loadConfig,
    createCheckpoint: overrides.createCheckpoint ?? createNativeCheckpoint,
    marker: overrides.marker ?? localMarker,
  };

  const reset = () => {
    state.payloadShapeBySession.clear();
    state.forcedCompaction = undefined;
  };
  api.onSessionStart(reset);
  api.onSessionShutdown(reset);
  api.onModelSelect((ctx) => {
    state.payloadShapeBySession.delete(ctx.sessionManager.getSessionId());
    const forced = state.forcedCompaction;
    if (forced) releaseForcedCompactionDisplay(api, state, forced);
  });
  api.onContext(handleContext);
  api.onBeforeProviderHeaders((event, ctx) => {
    if (!isOpenAICodexModel(ctx.model)) return;
    setFeatureHeader(event.headers);
  });
  api.onBeforeProviderRequest((event, ctx) => handleBeforeProviderRequest(deps, state, event, ctx));
  api.onSessionBeforeCompact((event, ctx) => handleSessionBeforeCompact(deps, state, event, ctx));
  api.onTurnEnd((ctx) => {
    handleTurnEnd(deps, state, ctx);
  });
  api.onSessionCompact((event, ctx) => {
    handleSessionCompact(state, event, ctx);
  });
  api.onAgentSettled((ctx) => {
    handleAgentSettled(deps, state, ctx);
  });
}
