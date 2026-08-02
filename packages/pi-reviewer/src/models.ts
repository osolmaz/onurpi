import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writePiRuntimeConfig, type PiAppDefinition } from "@osolmaz/pi-factory";

import { regularPiAuthPath } from "./auth-path.js";

export async function listReviewerModels(
  app: PiAppDefinition,
  search?: string,
): Promise<readonly string[]> {
  const config = await writePiRuntimeConfig(app);
  const runtime = await ModelRuntime.create({
    authPath: regularPiAuthPath(),
    modelsPath: config.modelsPath,
    allowModelNetwork: false,
  });
  const query = search?.toLowerCase();
  return (await runtime.getAvailable())
    .map((model) => `${model.provider}/${model.id}`)
    .filter((model) => query === undefined || model.toLowerCase().includes(query))
    .sort((left, right) => left.localeCompare(right));
}
