import type {
  ExtensionContext,
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
  onSessionCompact(
    handler: (event: SessionCompactEvent, ctx: ContextWindowPolicyContext) => void,
  ): void;
  onSessionShutdown(handler: () => void): void;
  onSessionStart(handler: () => void): void;
  onTurnEnd(handler: (event: TurnEndEvent, ctx: ContextWindowPolicyContext) => void): void;
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
};

type ControllerState = {
  active: ActiveRequest | undefined;
};

export type ContextWindowPolicyController = {
  agentSettled(ctx: ContextWindowPolicyContext): void;
  evaluate(ctx: ContextWindowPolicyContext): PolicyEvaluation;
  reset(): void;
  sessionCompacted(event: SessionCompactEvent, ctx: ContextWindowPolicyContext): void;
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

function hasCompactionConflict(ctx: ContextWindowPolicyContext): boolean {
  return !ctx.isIdle() || ctx.hasPendingMessages();
}

function continueAfterCompaction(
  api: ContextWindowPolicyApi,
  state: ControllerState,
  ctx: ContextWindowPolicyContext,
  expected: ActiveRequest,
): void {
  if (!clearExpected(state, expected) || !expected.resume || hasCompactionConflict(ctx)) return;
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
  if (hasCompactionConflict(ctx)) {
    state.active = {
      phase: "stopping",
      resume: false,
      sessionId: ctx.sessionManager.getSessionId(),
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

function handleSessionCompact(
  state: ControllerState,
  event: SessionCompactEvent,
  ctx: ContextWindowPolicyContext,
): void {
  const active = activeForContext(state, ctx);
  if (active?.phase !== "stopping") return;
  if (event.willRetry) {
    state.active = undefined;
    return;
  }
  state.active = { ...active, phase: "compacted" };
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
  const state: ControllerState = { active: undefined };
  return {
    agentSettled: (ctx) => {
      handleAgentSettled(api, state, ctx);
    },
    evaluate,
    reset: () => {
      state.active = undefined;
    },
    sessionCompacted: (event, ctx) => {
      handleSessionCompact(state, event, ctx);
    },
    turnEnded: (event, ctx) => {
      handleTurnEnd(state, event, ctx);
    },
  };
}

export function installContextWindowPolicy(api: ContextWindowPolicyApi): void {
  const controller = createContextWindowPolicyController(api);
  api.onTurnEnd((event, ctx) => {
    controller.turnEnded(event, ctx);
  });
  api.onAgentSettled((ctx) => {
    controller.agentSettled(ctx);
  });
  api.onSessionCompact((event, ctx) => {
    controller.sessionCompacted(event, ctx);
  });
  api.onModelSelect(() => {
    controller.reset();
  });
  api.onSessionStart(() => {
    controller.reset();
  });
  api.onSessionShutdown(() => {
    controller.reset();
  });
}
