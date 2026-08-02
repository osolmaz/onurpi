import path from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getPiAuthGrant, writePiRuntimeConfig, type PiAppDefinition } from "@osolmaz/pi-factory";

export async function listReviewerModels(
  app: PiAppDefinition,
  search?: string,
): Promise<readonly string[]> {
  const config = await writePiRuntimeConfig(app);
  const grant = await getPiAuthGrant(app.id);
  const runtime = await ModelRuntime.create({
    authPath: grant?.authFile ?? path.join(config.configDir, "auth.json"),
    modelsPath: config.modelsPath,
    allowModelNetwork: false,
  });
  const query = search?.toLowerCase();
  return (await runtime.getAvailable())
    .map((model) => `${model.provider}/${model.id}`)
    .filter((model) => query === undefined || model.toLowerCase().includes(query))
    .sort((left, right) => left.localeCompare(right));
}
