import type { Api, Model, Transport } from "@earendil-works/pi-ai";
import type { ApiStreamSimpleFunction } from "@earendil-works/pi-ai/compat";
import type {
  CompactionResult,
  SessionBeforeCompactEvent,
  compact,
} from "@earendil-works/pi-coding-agent";

const MAX_ATTEMPTS = 2;

export type CompactionFunction = typeof compact;
type CompactionThinkingLevel = NonNullable<Parameters<CompactionFunction>[6]>;

export type ReliableCompactionDependencies = {
  compact: CompactionFunction;
  streamSimple: ApiStreamSimpleFunction;
};

type SuccessfulAuth = {
  ok: true;
  apiKey?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

type FailedAuth = { ok: false; error: string };

type HookContext = {
  model: Model<Api> | undefined;
  modelRegistry: {
    getApiKeyAndHeaders(model: Model<Api>): Promise<SuccessfulAuth | FailedAuth>;
  };
  hasUI: boolean;
  ui: {
    notify(message: string, type: "info" | "warning" | "error"): void;
  };
};

type HookResult = { cancel?: boolean; compaction?: CompactionResult };
type HookEvent = Pick<SessionBeforeCompactEvent, "preparation" | "customInstructions" | "signal">;

export type SessionBeforeCompactHandler = (
  event: HookEvent,
  ctx: HookContext,
) => Promise<HookResult | undefined>;

export type ReliableCompactionApi = {
  getThinkingLevel(): CompactionThinkingLevel;
  onSessionBeforeCompact(handler: SessionBeforeCompactHandler): void;
};

export type CompactionPolicy = {
  maxAttempts: number;
  transport: Transport;
};

type CompactionRequest = {
  auth: SuccessfulAuth;
  event: HookEvent;
  model: Model<Api>;
  thinkingLevel: CompactionThinkingLevel;
};

export type ReliableCompactionOutcome =
  | { kind: "compaction"; compaction: CompactionResult; attempts: number }
  | { kind: "failure"; error: Error; attempts: number; aborted: boolean };

export function policyForModel(model: Model<Api>): CompactionPolicy | undefined {
  if (model.api !== "openai-codex-responses") return undefined;
  return { maxAttempts: MAX_ATTEMPTS, transport: "sse" };
}

export function forceTransport(
  streamSimple: ApiStreamSimpleFunction,
  transport: Transport,
): ApiStreamSimpleFunction {
  return (model, context, options) => streamSimple(model, context, { ...options, transport });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function wasAborted(signal: AbortSignal, error: Error): boolean {
  return signal.aborted || error.name === "AbortError";
}

export async function runReliableCompaction(
  request: CompactionRequest,
  policy: CompactionPolicy,
  dependencies: ReliableCompactionDependencies,
): Promise<ReliableCompactionOutcome> {
  const stream = forceTransport(dependencies.streamSimple, policy.transport);
  let lastError = new Error("Compaction did not run");

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (request.event.signal.aborted) {
      return { kind: "failure", error: lastError, attempts: attempt - 1, aborted: true };
    }
    try {
      const compaction = await dependencies.compact(
        request.event.preparation,
        request.model,
        request.auth.apiKey,
        request.auth.headers,
        request.event.customInstructions,
        request.event.signal,
        request.thinkingLevel,
        stream,
        request.auth.env,
      );
      return { kind: "compaction", compaction, attempts: attempt };
    } catch (error: unknown) {
      lastError = normalizeError(error);
      if (wasAborted(request.event.signal, lastError)) {
        return { kind: "failure", error: lastError, attempts: attempt, aborted: true };
      }
    }
  }

  return {
    kind: "failure",
    error: lastError,
    attempts: policy.maxAttempts,
    aborted: false,
  };
}

function notifyFailure(ctx: HookContext, message: string): void {
  if (ctx.hasUI) ctx.ui.notify(message, "error");
}

export function createSessionBeforeCompactHandler(
  dependencies: ReliableCompactionDependencies,
  getThinkingLevel: () => CompactionThinkingLevel,
): SessionBeforeCompactHandler {
  return async (event, ctx) => {
    const model = ctx.model;
    if (!model) return undefined;
    const policy = policyForModel(model);
    if (!policy) return undefined;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      notifyFailure(ctx, `Reliable compaction authentication failed: ${auth.error}`);
      return { cancel: true };
    }
    if (!auth.apiKey) {
      notifyFailure(ctx, `Reliable compaction has no credentials for ${model.provider}.`);
      return { cancel: true };
    }

    const outcome = await runReliableCompaction(
      { auth, event, model, thinkingLevel: getThinkingLevel() },
      policy,
      dependencies,
    );
    if (outcome.kind === "compaction") return { compaction: outcome.compaction };
    if (!outcome.aborted) {
      notifyFailure(
        ctx,
        `Reliable compaction failed after ${String(outcome.attempts)} attempts: ${outcome.error.message}`,
      );
    }
    return { cancel: true };
  };
}

export function installReliableCompaction(
  pi: ReliableCompactionApi,
  dependencies: ReliableCompactionDependencies,
): void {
  pi.onSessionBeforeCompact(
    createSessionBeforeCompactHandler(dependencies, () => pi.getThinkingLevel()),
  );
}
