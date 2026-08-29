import type {
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

export const CONTINUATION_MESSAGE_KIND = "onurpi-context-window-policy-continuation";
export const CONTINUATION_PROMPT = "Compaction completed. Continue.";

const AUTO_COMPACT_NUMERATOR = 9;
const AUTO_COMPACT_DENOMINATOR = 10;

type SelectedModel = Pick<
  NonNullable<ExtensionContext["model"]>,
  "api" | "contextWindow" | "provider"
>;

type ContinuationMessage = {
  customType: typeof CONTINUATION_MESSAGE_KIND;
  content: typeof CONTINUATION_PROMPT;
  display: false;
};

export type ContextWindowPolicyContext = Pick<
  ExtensionContext,
  "abort" | "compact" | "getContextUsage" | "hasPendingMessages" | "hasUI" | "isIdle" | "model"
> & {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId">;
  ui: Pick<ExtensionContext["ui"], "notify">;
};

export type ContextWindowPolicyApi = {
  onAgentSettled(handler: (ctx: ContextWindowPolicyContext) => void): void;
  onModelSelect(handler: () => void): void;
  onSessionBeforeCompact(
    handler: (event: SessionBeforeCompactEvent, ctx: ContextWindowPolicyContext) => void,
  ): void;
  onSessionCompact(
    handler: (event: SessionCompactEvent, ctx: ContextWindowPolicyContext) => void,
  ): void;
  onSessionCompactFailed(handler: (ctx: ContextWindowPolicyContext) => void): void;
  onSessionShutdown(handler: () => void): void;
  onSessionStart(handler: () => void): void;
  onTurnEnd(handler: (event: TurnEndEvent, ctx: ContextWindowPolicyContext) => void): void;
  scheduleAfterSettlement(handler: () => void): void;
  sendMessage(
    message: ContinuationMessage,
    options: { deliverAs: "followUp"; triggerTurn: true },
  ): void;
};

export type PolicyEvaluation = "below-limit" | "eligible" | "unavailable";

type PolicyInput = {
  limit: number;
  percent: number;
  tokens: number;
};

type ActiveRequest = {
  phase: "compacted" | "compacting" | "stopping";
  resume: boolean;
  sessionId: string;
  settlementReached: boolean;
};

type ControllerState = {
  active: ActiveRequest | undefined;
  externalCompactions: number;
};

export type ContextWindowPolicyController = {
  agentSettled(ctx: ContextWindowPolicyContext): void;
  agentSettlementStarted(ctx: ContextWindowPolicyContext): void;
  evaluate(ctx: ContextWindowPolicyContext): PolicyEvaluation;
  reset(): void;
  sessionBeforeCompact(ctx: ContextWindowPolicyContext): void;
  sessionCompacted(event: SessionCompactEvent, ctx: ContextWindowPolicyContext): boolean;
  sessionCompactionFailed(ctx: ContextWindowPolicyContext): boolean;
  turnEnded(event: TurnEndEvent, ctx: ContextWindowPolicyContext): void;
};

export function isCodexNativeModel(model: SelectedModel | undefined): boolean {
  return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}

function isTokenCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

export function autoCompactTokenLimit(contextWindow: number): number | undefined {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return undefined;

  const wholeTenths = Math.floor(contextWindow / AUTO_COMPACT_DENOMINATOR);
  const remainder = contextWindow % AUTO_COMPACT_DENOMINATOR;
  return (
    wholeTenths * AUTO_COMPACT_NUMERATOR +
    Math.floor((remainder * AUTO_COMPACT_NUMERATOR) / AUTO_COMPACT_DENOMINATOR)
  );
}

function policyInput(ctx: ContextWindowPolicyContext): PolicyInput | undefined {
  const model = ctx.model;
  if (!model || !isCodexNativeModel(model)) return undefined;
  const limit = autoCompactTokenLimit(model.contextWindow);
  const usage = ctx.getContextUsage();
  if (!usage || limit === undefined || !isTokenCount(usage.tokens)) return undefined;
  return {
    limit,
    percent: (usage.tokens / model.contextWindow) * 100,
    tokens: usage.tokens,
  };
}

function evaluate(ctx: ContextWindowPolicyContext): PolicyEvaluation {
  const input = policyInput(ctx);
  if (!input) return "unavailable";
  return input.tokens >= input.limit ? "eligible" : "below-limit";
}

function notify(
  ctx: ContextWindowPolicyContext,
  message: string,
  level: "error" | "warning",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function clearExpected(state: ControllerState, expected: ActiveRequest): boolean {
  if (state.active !== expected) return false;
  state.active = undefined;
  return true;
}

function hasTurnConflict(ctx: ContextWindowPolicyContext): boolean {
  return !ctx.isIdle() || ctx.hasPendingMessages();
}

function hasCompactionConflict(state: ControllerState, ctx: ContextWindowPolicyContext): boolean {
  return state.externalCompactions > 0 || hasTurnConflict(ctx);
}

function continueAfterCompaction(
  api: ContextWindowPolicyApi,
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
  expected: ActiveRequest,
): void {
  if (!clearExpected(state, expected) || !expected.resume || hasCompactionConflict(state, ctx))
    return;
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
    const message = error instanceof Error ? error.message : String(error);
    notify(ctx, `Context continuation failed: ${message}`, "error");
  }
}

function startCompaction(
  api: ContextWindowPolicyApi,
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
  resume: boolean,
): void {
  const request: ActiveRequest = {
    phase: "compacting",
    resume,
    sessionId: ctx.sessionManager.getSessionId(),
    settlementReached: true,
  };
  state.active = request;
  try {
    ctx.compact({
      onComplete: () => {
        continueAfterCompaction(api, state, ctx, request);
      },
      onError: (error) => {
        if (!clearExpected(state, request)) return;
        notify(ctx, `Context compaction failed: ${error.message}`, "error");
      },
    });
  } catch (error) {
    clearExpected(state, request);
    throw error;
  }
}

function compactAtSafeSettlement(
  api: ContextWindowPolicyApi,
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
  resume: boolean,
): void {
  const sessionId = ctx.sessionManager.getSessionId();
  if (state.externalCompactions > 0) {
    state.active = {
      phase: "stopping",
      resume,
      sessionId,
      settlementReached: true,
    };
    return;
  }
  if (hasTurnConflict(ctx)) {
    state.active = {
      phase: "stopping",
      resume: false,
      sessionId,
      settlementReached: true,
    };
    return;
  }
  startCompaction(api, state, ctx, resume);
}

function activeForContext(
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
): ActiveRequest | undefined {
  const active = state.active;
  return active?.sessionId === ctx.sessionManager.getSessionId() ? active : undefined;
}

function handleTurnEnd(
  state: ControllerState,
  event: TurnEndEvent,
  ctx: ContextWindowPolicyContext,
): void {
  if (state.active || event.toolResults.length === 0) return;
  const input = policyInput(ctx);
  if (!input || input.tokens < input.limit) return;

  const request: ActiveRequest = {
    phase: "stopping",
    resume: !ctx.hasPendingMessages(),
    sessionId: ctx.sessionManager.getSessionId(),
    settlementReached: false,
  };
  state.active = request;
  notify(
    ctx,
    `Codex context reached ${input.percent.toFixed(1)}%; stopping for compaction.`,
    "warning",
  );
  try {
    ctx.abort();
  } catch (error) {
    clearExpected(state, request);
    throw error;
  }
}

function handleSessionBeforeCompact(state: ControllerState): void {
  if (state.active?.phase !== "compacting") state.externalCompactions += 1;
}

function finishExternalCompaction(state: ControllerState): boolean {
  if (state.externalCompactions === 0) return false;
  state.externalCompactions -= 1;
  return true;
}

function handleSessionCompact(
  state: ControllerState,
  event: SessionCompactEvent,
  ctx: ContextWindowPolicyContext,
): boolean {
  const wasExternal = finishExternalCompaction(state);
  const active = activeForContext(state, ctx);
  if (active?.phase !== "stopping") return false;
  if (event.willRetry) {
    state.active = undefined;
    return false;
  }
  state.active = { ...active, phase: "compacted" };
  return wasExternal && active.settlementReached;
}

function handleSessionCompactionFailed(
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
): boolean {
  const wasExternal = finishExternalCompaction(state);
  const active = activeForContext(state, ctx);
  return wasExternal && active?.phase === "stopping" && active.settlementReached;
}

function handleAgentSettlementStarted(
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
): void {
  const active = activeForContext(state, ctx);
  if (active?.phase === "stopping") active.settlementReached = true;
}

function handleAgentSettled(
  api: ContextWindowPolicyApi,
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
): void {
  const active = activeForContext(state, ctx);
  if (active?.phase === "compacted") {
    continueAfterCompaction(api, state, ctx, active);
    return;
  }
  if (active?.phase === "stopping") {
    compactAtSafeSettlement(api, state, ctx, active.resume);
    return;
  }
  if (active || evaluate(ctx) !== "eligible") return;
  compactAtSafeSettlement(api, state, ctx, false);
}

export function createContextWindowPolicyController(
  api: ContextWindowPolicyApi,
): ContextWindowPolicyController {
  const state: ControllerState = { active: undefined, externalCompactions: 0 };
  return {
    agentSettled: (ctx) => {
      handleAgentSettled(api, state, ctx);
    },
    agentSettlementStarted: (ctx) => {
      handleAgentSettlementStarted(state, ctx);
    },
    evaluate,
    reset: () => {
      state.active = undefined;
      state.externalCompactions = 0;
    },
    sessionBeforeCompact: () => {
      handleSessionBeforeCompact(state);
    },
    sessionCompacted: (event, ctx) => handleSessionCompact(state, event, ctx),
    sessionCompactionFailed: (ctx) => handleSessionCompactionFailed(state, ctx),
    turnEnded: (event, ctx) => {
      handleTurnEnd(state, event, ctx);
    },
  };
}

export function installContextWindowPolicy(api: ContextWindowPolicyApi): void {
  const controller = createContextWindowPolicyController(api);
  let lifecycleVersion = 0;
  const reset = (): void => {
    lifecycleVersion += 1;
    controller.reset();
  };
  const schedulePolicyCheck = (ctx: ContextWindowPolicyContext): void => {
    const expectedVersion = lifecycleVersion;
    api.scheduleAfterSettlement(() => {
      if (lifecycleVersion !== expectedVersion) return;
      try {
        controller.agentSettled(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(ctx, `Context compaction failed: ${message}`, "error");
      }
    });
  };
  api.onTurnEnd((event, ctx) => {
    controller.turnEnded(event, ctx);
  });
  api.onAgentSettled((ctx) => {
    controller.agentSettlementStarted(ctx);
    schedulePolicyCheck(ctx);
  });
  api.onSessionBeforeCompact((_event, ctx) => {
    controller.sessionBeforeCompact(ctx);
  });
  api.onSessionCompact((event, ctx) => {
    if (controller.sessionCompacted(event, ctx)) schedulePolicyCheck(ctx);
  });
  api.onSessionCompactFailed((ctx) => {
    if (controller.sessionCompactionFailed(ctx)) schedulePolicyCheck(ctx);
  });
  api.onModelSelect(reset);
  api.onSessionStart(reset);
  api.onSessionShutdown(reset);
}
