import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  Transport,
} from "@earendil-works/pi-ai";
import type { ProviderConfig, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

const MAX_ATTEMPTS = 2;

type ApiStreamSimpleFunction = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type HookEvent = Pick<SessionBeforeCompactEvent, "preparation">;

type HookContext = {
  model: Model<Api> | undefined;
  modelRegistry: {
    getRegisteredProviderConfig(provider: string): unknown;
  };
};

export type SessionBeforeCompactHandler = (
  event: HookEvent,
  ctx: HookContext,
) => Promise<void> | void;

export type ReliableCompactionApi = {
  onBeforeAgentStart(handler: () => void): void;
  onSessionBeforeCompact(handler: SessionBeforeCompactHandler): void;
  onSessionCompact(handler: () => void): void;
  onSessionShutdown(handler: () => void): void;
  registerProvider(name: string, config: ProviderConfig): void;
  unregisterProvider(name: string): void;
};

export type ReliableCompactionDependencies = {
  streamSimple: ApiStreamSimpleFunction;
};

export type CompactionPolicy = {
  maxAttempts: number;
  transport: Transport;
};

type RegisteredProviderReader = HookContext["modelRegistry"];

type ActiveOverride = {
  config: ProviderConfig;
  provider: string;
  registry: RegisteredProviderReader;
  remainingCalls: number;
};

function isOwnedOverride(value: unknown, expected: ProviderConfig): boolean {
  if (typeof value !== "object" || value === null || !("streamSimple" in value)) return false;
  return value.streamSimple === expected.streamSimple;
}

export function policyForModel(model: Model<Api>): CompactionPolicy | undefined {
  if (model.api !== "openai-codex-responses") return undefined;
  return { maxAttempts: MAX_ATTEMPTS, transport: "sse" };
}

export function expectedSummaryCalls(event: HookEvent): number {
  const { isSplitTurn, messagesToSummarize, turnPrefixMessages } = event.preparation;
  if (!isSplitTurn || turnPrefixMessages.length === 0) return 1;
  return messagesToSummarize.length > 0 ? 2 : 1;
}

export function withCompactionPolicy(
  streamSimple: ApiStreamSimpleFunction,
  policy: CompactionPolicy,
  settled: (failed: boolean) => void,
): ApiStreamSimpleFunction {
  return (model, context, options) => {
    let stream: AssistantMessageEventStream;
    try {
      stream = streamSimple(model, context, {
        ...options,
        maxRetries: policy.maxAttempts - 1,
        transport: policy.transport,
      });
    } catch (error: unknown) {
      settled(true);
      throw error;
    }

    void stream.result().then(
      (message) => {
        settled(message.stopReason === "error" || message.stopReason === "aborted");
      },
      () => {
        settled(true);
      },
    );
    return stream;
  };
}

type ReliableCompactionController = {
  cleanup: () => void;
  handleBeforeCompact: SessionBeforeCompactHandler;
};

function createReliableCompactionController(
  pi: Pick<ReliableCompactionApi, "registerProvider" | "unregisterProvider">,
  dependencies: ReliableCompactionDependencies,
): ReliableCompactionController {
  let active: ActiveOverride | undefined;

  const restoreProvider = (expected: ActiveOverride): void => {
    if (active !== expected) return;
    active = undefined;
    const registered = expected.registry.getRegisteredProviderConfig(expected.provider);
    if (registered === undefined || isOwnedOverride(registered, expected.config)) {
      pi.unregisterProvider(expected.provider);
    }
  };

  return {
    cleanup: () => {
      if (active) restoreProvider(active);
    },
    handleBeforeCompact: (event, ctx) => {
      const model = ctx.model;
      if (!model) return;
      const policy = policyForModel(model);
      if (!policy) return;

      if (active) restoreProvider(active);

      // Do not replace a stream handler supplied by another extension.
      if (ctx.modelRegistry.getRegisteredProviderConfig(model.provider) !== undefined) return;

      const override: ActiveOverride = {
        config: {},
        provider: model.provider,
        registry: ctx.modelRegistry,
        remainingCalls: expectedSummaryCalls(event),
      };
      const streamSimple = withCompactionPolicy(dependencies.streamSimple, policy, (failed) => {
        override.remainingCalls -= 1;
        if (failed || override.remainingCalls === 0) restoreProvider(override);
      });
      override.config = { api: model.api, streamSimple };
      active = override;

      pi.registerProvider(model.provider, override.config);
    },
  };
}

export function createSessionBeforeCompactHandler(
  pi: Pick<ReliableCompactionApi, "registerProvider" | "unregisterProvider">,
  dependencies: ReliableCompactionDependencies,
): SessionBeforeCompactHandler {
  return createReliableCompactionController(pi, dependencies).handleBeforeCompact;
}

export function installReliableCompaction(
  pi: ReliableCompactionApi,
  dependencies: ReliableCompactionDependencies,
): void {
  const controller = createReliableCompactionController(pi, dependencies);
  pi.onSessionBeforeCompact(controller.handleBeforeCompact);
  pi.onSessionCompact(controller.cleanup);
  pi.onBeforeAgentStart(controller.cleanup);
  pi.onSessionShutdown(controller.cleanup);
}
