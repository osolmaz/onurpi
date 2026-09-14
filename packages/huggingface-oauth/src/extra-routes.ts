import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/**
 * Hugging Face routes that the pinned extension drops from the model catalog.
 *
 * `pi-huggingface-oauth` builds its route list from `https://router.huggingface.co/v1/models` and
 * keeps a route only when the catalog reports `live` status, tool support, a context length, and
 * both input and output prices. Two routes of DeepSeek V4.1 Flash fail that test while they still
 * answer calls, so OnurPi registers them explicitly.
 *
 * - Baseten reports `error` status and still serves requests.
 * - Fireworks publishes no price, so the extension cannot show a cost for it.
 *
 * Both entries copy the price and thinking map of the Novita route of the same model, and use the
 * 272000 token context window that this repository already applies to that model.
 */
export const EXTRA_ROUTE_MODELS: readonly ProviderModelConfig[] = [
  {
    id: "deepseek-ai/DeepSeek-V4.1-Flash:baseten",
    name: "DeepSeek V4.1 Flash \u00b7 Baseten",
    api: "openai-completions",
    baseUrl: "https://router.huggingface.co/v1",
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    input: ["text", "image"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 384000,
    compat: { supportsDeveloperRole: false },
  },
  {
    id: "deepseek-ai/DeepSeek-V4.1-Flash:fireworks-ai",
    name: "DeepSeek V4.1 Flash \u00b7 Fireworks",
    api: "openai-completions",
    baseUrl: "https://router.huggingface.co/v1",
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    input: ["text", "image"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 384000,
    compat: { supportsDeveloperRole: false },
  },
];
