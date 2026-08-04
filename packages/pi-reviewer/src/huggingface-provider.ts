import { dirname, join } from "node:path";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import type { createHuggingFaceProviderConfig } from "pi-huggingface-oauth";

type RegisterProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];
type HuggingFaceModule = Readonly<{
  createHuggingFaceProviderConfig: typeof createHuggingFaceProviderConfig;
}>;

export function canonicalModelsStorePath(authPath: string): string {
  return join(dirname(authPath), "models-store.json");
}

async function loadHuggingFaceProviderConfig(): Promise<
  ReturnType<typeof createHuggingFaceProviderConfig>
> {
  const jiti = createJiti(import.meta.url);
  const module = await jiti.import<HuggingFaceModule>("pi-huggingface-oauth/index.ts");
  return module.createHuggingFaceProviderConfig();
}

function huggingFaceRegistration(
  source: ReturnType<typeof createHuggingFaceProviderConfig>,
): RegisterProviderConfig {
  const registration: RegisterProviderConfig = {};
  const oauth = source.oauth;
  if (oauth !== undefined) {
    registration.oauth = {
      name: oauth.name,
      login: (callbacks) => oauth.login(callbacks),
      refreshToken: (credentials) => oauth.refreshToken(credentials),
      getApiKey: (credentials) => oauth.getApiKey(credentials),
    };
  }
  const refreshModels = source.refreshModels?.bind(source);
  if (refreshModels !== undefined) {
    registration.refreshModels = refreshModels;
  }
  return registration;
}

export async function registerHuggingFaceOAuthProvider(runtime: ModelRuntime): Promise<void> {
  runtime.registerProvider(
    "huggingface",
    huggingFaceRegistration(await loadHuggingFaceProviderConfig()),
  );
  await runtime.refresh({ allowNetwork: false });
}
