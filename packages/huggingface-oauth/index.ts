import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import registerUpstream, { type ProviderRegistrar } from "pi-huggingface-oauth/index.ts";

import { EXTRA_ROUTE_MODELS } from "./src/extra-routes.ts";

type RefreshModels = NonNullable<ProviderConfig["refreshModels"]>;

/**
 * Append the manual route models to the pinned extension's model refresh.
 *
 * A provider registered by an extension replaces the whole model list with what its `refreshModels`
 * returns, so `models.json` model entries for that provider are dropped. The extra routes therefore
 * have to be added here, inside the extension's own refresh.
 */
export function withExtraRouteModels(config: ProviderConfig): ProviderConfig {
  const refreshModels = config.refreshModels?.bind(config);
  if (refreshModels === undefined) return config;

  const refreshWithExtraRoutes: RefreshModels = async (context) => {
    const models: ProviderModelConfig[] = await refreshModels(context);
    const knownIds = new Set(models.map((model) => model.id));
    return [...models, ...EXTRA_ROUTE_MODELS.filter((model) => !knownIds.has(model.id))];
  };

  return { ...config, refreshModels: refreshWithExtraRoutes };
}

export default function registerHuggingFaceOAuth(pi: ProviderRegistrar): void {
  registerUpstream({
    registerProvider(name, config) {
      pi.registerProvider(name, withExtraRouteModels(config));
    },
  });
}
