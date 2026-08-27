import { randomUUID } from "node:crypto";

import type {
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  CompactionResult,
  ContextEvent,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionEntry,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

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

/**
 * Bounded error for the branch snapshot fence. A remote checkpoint computed from a stale input
 * snapshot must never be appended, so the fence failure cancels Pi's compaction without content.
 */
export const BRANCH_FENCE_ERROR =
  "Session branch changed while the OpenAI Codex remote compaction was in flight; the checkpoint was discarded.";

export type CompactionStatus = {
  operationId: string;
  state: "running" | "complete" | "failed";
  error?: string;
};

type CachedPayloadShape = {
  modelKey: string;
  payload: JsonObject;
};

/** Minimal context surface the controller needs; `ExtensionContext` satisfies it. */
export type CodexCompactionContext = Pick<
  ExtensionContext,
  "model" | "mode" | "hasUI" | "abort" | "getSystemPrompt"
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
  appendEntry(customType: string, data: CompactionStatus): void;
  getAllTools(): ToolInfo[];
  getActiveTools(): string[];
};

type ControllerState = {
  payloadShapeBySession: Map<string, CachedPayloadShape>;
};

type ControllerDeps = {
  api: CodexCompactionApi;
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
  operationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  appendCompactionStatus(deps.api, ctx, { operationId, state: "running" });
  try {
    const result = await operation();
    appendCompactionStatus(deps.api, ctx, { operationId, state: "complete" });
    return result;
  } catch (error) {
    appendCompactionStatus(deps.api, ctx, {
      operationId,
      state: "failed",
      error: errorMessage(error),
    });
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

/** Only non-context status entries from this compaction operation may follow the snapshot tip. */
function isOwnStatusEntry(entry: SessionEntry, operationId: string): boolean {
  if (
    entry.type !== "custom" ||
    entry.customType !== COMPACTION_STATUS_KIND ||
    typeof entry.data !== "object" ||
    entry.data === null
  ) {
    return false;
  }
  return Reflect.get(entry.data, "operationId") === operationId;
}

/**
 * Fail closed when the active branch moved past the compaction input snapshot. The remote
 * checkpoint was computed from `event.branchEntries`; appending it after new context-bearing
 * entries (for example an assistant function call whose result is still pending) would splice the
 * checkpoint between those entries and corrupt the replayed Responses history.
 */
function assertBranchFence(
  ctx: CodexCompactionContext,
  snapshotTipId: string | null,
  operationId: string,
): void {
  const branch = ctx.sessionManager.getBranch();
  let tipIndex = -1;
  if (snapshotTipId !== null) {
    for (let index = branch.length - 1; index >= 0; index--) {
      if (branch[index]?.id === snapshotTipId) {
        tipIndex = index;
        break;
      }
    }
    if (tipIndex < 0) throw new Error(BRANCH_FENCE_ERROR);
  }
  if (branch.slice(tipIndex + 1).some((entry) => !isOwnStatusEntry(entry, operationId))) {
    throw new Error(BRANCH_FENCE_ERROR);
  }
}

function abandonCompaction(
  event: SessionBeforeCompactEvent,
  ctx: CodexCompactionContext,
  error: unknown,
): { cancel: true } {
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

  const snapshotTipId = event.branchEntries.at(-1)?.id ?? null;
  const operationId = randomUUID();
  try {
    const native = await withCompactionStatus(deps, ctx, operationId, async () => {
      const checkpoint = await deps.createCheckpoint(
        checkpointParams(deps, state, event, ctx, model),
      );
      assertBranchFence(ctx, snapshotTipId, operationId);
      return checkpoint;
    });
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
    return abandonCompaction(event, ctx, error);
  }
}

export function installCodexCompaction(
  api: CodexCompactionApi,
  overrides: Partial<Pick<ControllerDeps, "createCheckpoint" | "marker">> = {},
): void {
  const state: ControllerState = {
    payloadShapeBySession: new Map(),
  };
  const deps: ControllerDeps = {
    api,
    createCheckpoint: overrides.createCheckpoint ?? createNativeCheckpoint,
    marker: overrides.marker ?? localMarker,
  };

  const reset = () => {
    state.payloadShapeBySession.clear();
  };
  api.onSessionStart(reset);
  api.onSessionShutdown(reset);
  api.onModelSelect((ctx) => {
    state.payloadShapeBySession.delete(ctx.sessionManager.getSessionId());
  });
  api.onContext(handleContext);
  api.onBeforeProviderHeaders((event, ctx) => {
    if (!isOpenAICodexModel(ctx.model)) return;
    setFeatureHeader(event.headers);
  });
  api.onBeforeProviderRequest((event, ctx) => handleBeforeProviderRequest(deps, state, event, ctx));
  api.onSessionBeforeCompact((event, ctx) => handleSessionBeforeCompact(deps, state, event, ctx));
}
