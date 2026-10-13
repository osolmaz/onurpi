/**
 * Effective context-window capping, free of the extension API for testing.
 *
 * Pi's automatic compaction triggers when the projected context passes
 * `contextWindow - reserveTokens`, and it checks that threshold mid-run between tool batches,
 * which never aborts the active run. By capping the selected model's `contextWindow` at
 * `ceiling + reserve`, Pi's own check fires at the ceiling instead of at the model's real window,
 * so a long run compacts at the first tool-batch boundary after crossing it.
 *
 * The cap is applied by re-registering the model's provider with a cloned model list. Clones pick
 * exactly the fields of the provider model configuration; extra runtime fields must not leak into
 * `registerProvider`, which validates its input eagerly.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/**
 * Pi's default compaction reserve: settings.json `compaction.reserveTokens`. Pi subtracts this
 * from the (capped) context window to place the compaction threshold, so the window must be
 * raised by the same amount to make the threshold land on the ceiling. If Pi's setting changes,
 * the threshold moves by the difference; it then compacts earlier, never later, and the
 * settle-time compaction still covers the rest.
 */
export const DEFAULT_RESERVE_TOKENS = 16_384;

/**
 * The provider model configuration fields this extension clones, in the shape the registry hands
 * out. All fields are plain data; nested objects are deep-cloned so re-registered configs do not
 * alias live registry objects.
 */
export type CatalogModel = {
  type?: "chat" | "image" | "classifier";
  id: string;
  name: string;
  api: string;
  provider?: string;
  baseUrl?: string;
  input: ("text" | "image")[];
  inputLimits?: unknown;
  cost: unknown;
  headers?: Record<string, string>;
  reasoning?: boolean;
  thinkingLevelMap?: unknown;
  promptCache?: unknown;
  contextWindow?: number;
  maxTokens?: number;
  samplingParams?: Record<string, unknown>;
  samplingParamsByThinkingLevel?: Record<string, unknown>;
  compat?: unknown;
  output?: ("text" | "image")[];
};

/** The effective context window that makes Pi's threshold land exactly on the ceiling. */
export function capWindowForCeiling(
  ceilingTokens: number,
  reserveTokens: number = DEFAULT_RESERVE_TOKENS,
): number {
  return ceilingTokens + reserveTokens;
}

function cloneCommon(model: CatalogModel) {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
    input: [...model.input],
    ...(model.inputLimits === undefined ? {} : { inputLimits: structuredClone(model.inputLimits) }),
    cost: structuredClone(model.cost),
    ...(model.headers === undefined ? {} : { headers: structuredClone(model.headers) }),
  };
}

function cloneChat(model: CatalogModel, capWindow: number): ProviderModelConfig {
  return {
    ...cloneCommon(model),
    type: "chat",
    reasoning: model.reasoning === true,
    ...(model.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: structuredClone(model.thinkingLevelMap) }),
    ...(model.promptCache === undefined ? {} : { promptCache: structuredClone(model.promptCache) }),
    contextWindow: Math.min(model.contextWindow ?? capWindow, capWindow),
    maxTokens: model.maxTokens ?? 0,
    ...(model.samplingParams === undefined
      ? {}
      : { samplingParams: structuredClone(model.samplingParams) }),
    ...(model.samplingParamsByThinkingLevel === undefined
      ? {}
      : { samplingParamsByThinkingLevel: structuredClone(model.samplingParamsByThinkingLevel) }),
    ...(model.compat === undefined ? {} : { compat: structuredClone(model.compat) }),
  } as ProviderModelConfig;
}

function cloneImage(model: CatalogModel): ProviderModelConfig {
  return {
    ...cloneCommon(model),
    type: "image",
    output: [...(model.output ?? ["image"])],
  } as ProviderModelConfig;
}

function cloneClassifier(model: CatalogModel): ProviderModelConfig {
  return {
    ...cloneCommon(model),
    type: "classifier",
    contextWindow: model.contextWindow ?? 0,
  } as ProviderModelConfig;
}

/**
 * Largest context window among the chat models of a captured list, or 0 when none. A selected
 * object that already carries a capped window must not hide that the provider's original window
 * still exceeds a new cap level, so cap decisions consult this instead of the live selection.
 */
export function chatWindowCeiling(originalConfigs: readonly CatalogModel[] | undefined): number {
  return Math.max(
    0,
    ...(originalConfigs ?? [])
      .filter((model) => (model.type ?? "chat") === "chat")
      .map((model) => model.contextWindow ?? 0),
  );
}

/** Result of capping one provider's model list. */
export type CappedProvider = {
  configs: ProviderModelConfig[];
  /** IDs of chat models whose window was reduced. */
  cappedIds: string[];
};

/**
 * Build a cloned provider model list with every chat model capped at `capWindow`. Returns
 * undefined when no chat model exceeds the cap, so providers that need no change are never
 * re-registered. Image and classifier models pass through untouched. Always derive from the
 * original list: capping an already-capped list would lose the original window when the cap
 * moves up.
 */
export function capProviderModels(
  models: readonly CatalogModel[],
  capWindow: number,
): CappedProvider | undefined {
  const overCap = models.filter(
    (model) => (model.type ?? "chat") === "chat" && (model.contextWindow ?? 0) > capWindow,
  );
  if (overCap.length === 0) return undefined;
  const configs = models.map((model) => {
    if ((model.type ?? "chat") === "chat") return cloneChat(model, capWindow);
    if (model.type === "image") return cloneImage(model);
    return cloneClassifier(model);
  });
  return { configs, cappedIds: overCap.map((model) => model.id) };
}
