import type {
  CompactOptions,
  ContextUsage,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const AUTO_COMPACT_NUMERATOR = 9;
const AUTO_COMPACT_DENOMINATOR = 10;

type SelectedModel = Pick<NonNullable<ExtensionContext["model"]>, "contextWindow">;

export type ContextWindowPolicyContext = {
  model: SelectedModel | undefined;
  compact(options?: CompactOptions): void;
  getContextUsage(): ContextUsage | undefined;
  isIdle(): boolean;
};

export type ContextWindowPolicyApi = {
  onAgentSettled(handler: (ctx: ContextWindowPolicyContext) => void): void;
  onModelSelect(handler: (ctx: ContextWindowPolicyContext) => void): void;
  onSessionCompact(handler: () => void): void;
  onSessionShutdown(handler: () => void): void;
  onSessionStart(handler: () => void): void;
};

export type PolicyEvaluation = "below-limit" | "pending" | "triggered" | "unavailable";

export type ContextWindowPolicyController = {
  evaluate(ctx: ContextWindowPolicyContext): PolicyEvaluation;
  reset(): void;
};

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
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

type PolicyInput = {
  limit: number;
  tokens: number;
};

function readPolicyInput(ctx: ContextWindowPolicyContext): PolicyInput | undefined {
  if (!ctx.model) return undefined;
  const limit = autoCompactTokenLimit(ctx.model.contextWindow);
  const tokens = ctx.getContextUsage()?.tokens;
  if (limit === undefined || tokens === null || tokens === undefined || !isTokenCount(tokens)) {
    return undefined;
  }
  return { limit, tokens };
}

export function createContextWindowPolicyController(): ContextWindowPolicyController {
  let activeRequest: object | undefined;

  const release = (request: object): void => {
    if (activeRequest === request) activeRequest = undefined;
  };

  return {
    evaluate: (ctx) => {
      if (activeRequest) return "pending";

      const input = readPolicyInput(ctx);
      if (!input) return "unavailable";
      if (input.tokens < input.limit) return "below-limit";

      const request = {};
      activeRequest = request;
      try {
        ctx.compact({
          onComplete: () => {
            release(request);
          },
          onError: () => {
            release(request);
          },
        });
      } catch (error: unknown) {
        release(request);
        throw error;
      }
      return "triggered";
    },
    reset: () => {
      activeRequest = undefined;
    },
  };
}

export function installContextWindowPolicy(pi: ContextWindowPolicyApi): void {
  const controller = createContextWindowPolicyController();
  pi.onAgentSettled((ctx) => {
    if (ctx.isIdle()) controller.evaluate(ctx);
  });
  pi.onModelSelect((ctx) => {
    if (ctx.isIdle()) controller.evaluate(ctx);
  });
  pi.onSessionStart(() => {
    controller.reset();
  });
  pi.onSessionCompact(() => {
    controller.reset();
  });
  pi.onSessionShutdown(() => {
    controller.reset();
  });
}
