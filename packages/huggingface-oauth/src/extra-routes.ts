import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/**
 * The Hugging Face route that the pinned extension drops from the model catalog.
 *
 * `pi-huggingface-oauth` builds its route list from `https://router.huggingface.co/v1/models` and
 * keeps a route only when the catalog reports `live` status, tool support, a context length, and
 * both input and output prices. The Fireworks route of DeepSeek V4.1 Flash is live with tool
 * support and a context length, but the router publishes no pricing key for it, so the pinned
 * extension hides it while the route answers requests.
 *
 * Pi model entries need a numeric cost, so the entry carries the price and the remaining values
 * that the pinned extension uses for the other routes of the same model. The name states that the
 * price is not published, so the copied number is never read as a Fireworks price.
 *
 * Remove this entry when the router publishes a price for the route.
 */
export const EXTRA_ROUTE_MODELS: readonly ProviderModelConfig[] = [
  {
    id: "deepseek-ai/DeepSeek-V4.1-Flash:fireworks-ai",
    name: "DeepSeek V4.1 Flash \u00b7 Auto \u00b7 Fireworks (price not published)",
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
    contextWindow: 1048576,
    maxTokens: 384000,
    compat: { supportsDeveloperRole: false },
  },
];
