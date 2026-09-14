import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerHuggingFaceOAuth, { withExtraRouteModels } from "./index.ts";
import { EXTRA_ROUTE_MODELS } from "./src/extra-routes.ts";

const refreshContext = {} as Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0];
const extraRouteIds = EXTRA_ROUTE_MODELS.map((model) => model.id);

function model(id: string): ProviderModelConfig {
  return {
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://router.huggingface.co/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  };
}

describe("Hugging Face OAuth wrapper", () => {
  it("exports the pinned extension factory", () => {
    expect(registerHuggingFaceOAuth).toBeTypeOf("function");
  });

  it("marks every appended route whose price the router does not publish", () => {
    expect(extraRouteIds.length).toBeGreaterThan(0);
    for (const route of EXTRA_ROUTE_MODELS) {
      expect(route.name).toContain("price not published");
      expect(route.cost.input).toBeGreaterThan(0);
      expect(route.cost.output).toBeGreaterThan(0);
    }
  });

  it("appends the manual routes after the pinned route list", async () => {
    const config: ProviderConfig = { refreshModels: () => Promise.resolve([model("a/b")]) };

    const models = await withExtraRouteModels(config).refreshModels?.(refreshContext);

    expect(models?.map((entry) => entry.id)).toEqual(["a/b", ...extraRouteIds]);
  });

  it("keeps one copy of a route that the pinned list already has", async () => {
    const first = EXTRA_ROUTE_MODELS[0];
    if (first === undefined) throw new Error("expected a manual route");
    const config: ProviderConfig = { refreshModels: () => Promise.resolve([{ ...first }]) };

    const models = await withExtraRouteModels(config).refreshModels?.(refreshContext);

    expect(models?.map((entry) => entry.id)).toEqual([first.id, ...extraRouteIds.slice(1)]);
  });

  it("leaves a provider config without a model refresh untouched", () => {
    const config: ProviderConfig = { name: "huggingface" };

    expect(withExtraRouteModels(config)).toBe(config);
  });

  it("registers the pinned provider with the manual routes", async () => {
    const registerProvider = vi.fn<(name: string, config: ProviderConfig) => void>();

    registerHuggingFaceOAuth({ registerProvider });

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const call = registerProvider.mock.calls[0];
    if (call === undefined) throw new Error("expected one provider registration");
    const [name, config] = call;
    expect(name).toBe("huggingface");
    expect(config.oauth).toBeDefined();
    const models = await config.refreshModels?.(refreshContext);
    for (const id of extraRouteIds) {
      expect(models?.some((entry) => entry.id === id)).toBe(true);
    }
  });
});
