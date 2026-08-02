import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPiApp, manifestToDefinition, type PiAppDefinition } from "@osolmaz/pi-factory";

import type { ModelSelection } from "./types.js";

export type AppOptions = {
  readonly packageRoot?: string;
  readonly piCommand?: readonly string[];
};

export async function loadReviewerApp(options: AppOptions = {}): Promise<PiAppDefinition> {
  const packageRoot =
    options.packageRoot ?? (await findPackageRoot(fileURLToPath(import.meta.url)));
  const loaded = await loadPiApp({ appDir: packageRoot });
  const app = await manifestToDefinition(loaded.manifest, loaded.appRoot);
  return {
    ...app,
    piCommand: options.piCommand ?? resolveWorkerCommand(),
    forwardedArgs: ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
  };
}

export function selectAppModel(app: PiAppDefinition, selection: ModelSelection): PiAppDefinition {
  return {
    ...app,
    providers: [
      {
        id: selection.provider,
        source: "pi",
        models: [{ id: selection.model, reasoning: true }],
      },
    ],
    defaultProvider: selection.provider,
    defaultModel: selection.model,
    thinking: selection.thinking,
  };
}

async function findPackageRoot(start: string): Promise<string> {
  let current = path.dirname(start);
  for (;;) {
    if (await exists(path.join(current, "pi-factory.toml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("could not find Pi Reviewer app bundle");
    current = parent;
  }
}

function resolveWorkerCommand(): readonly string[] {
  return [process.execPath, path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js")];
}

async function exists(file: string): Promise<boolean> {
  return await access(file).then(
    () => true,
    () => false,
  );
}
