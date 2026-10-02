// Raise Hugging Face model context windows to a floor in the tracked `model-overrides.json`.
//
// The Hugging Face router catalog reports true per-model context windows, and many are far below
// what Onur wants Pi to assume. Pi has no provider-wide context override: `modelOverrides` keys on
// exact model IDs, and the model registry hands out copies, so no runtime extension can patch
// metadata. The only documented mechanism is one override entry per model, so this script
// generates those entries from the cached catalog instead of hand-writing them.
//
//   node scripts/hf-context-floor.ts
//
// Floor semantics: models below the floor are raised to it; models at or above it are never
// lowered, and existing override entries are preserved. Re-run after `pi update --models` picks up
// new catalog entries. Run `node scripts/sync-settings.ts sync` afterwards to converge the live
// `models.json`, then reload `/model`.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROVIDER = "huggingface";
const CONTEXT_FLOOR = 272_000;
const trackedOverridesPath = join(import.meta.dirname, "..", "model-overrides.json");
const catalogStorePath = join(homedir(), ".pi", "agent", "models-store.json");

export type CatalogModel = { id: string; contextWindow?: number };
export type OverrideMap = Record<string, unknown>;

/**
 * Compute the merged override map for one provider: a context-window floor for every catalog model
 * below it. Entries for models at or above the floor are removed when they are pure floor entries
 * (only `contextWindow`, equal to the floor); anything with extra fields or another window is
 * treated as a manual entry and kept. Entries for models missing from the catalog are kept too.
 */
export function applyContextFloor(
  existing: OverrideMap,
  catalogModels: CatalogModel[],
  floor: number,
): OverrideMap {
  let merged: OverrideMap = { ...existing };
  for (const model of catalogModels) {
    const current = recordOrUndefined(merged[model.id]);
    if (typeof model.contextWindow !== "number") continue;
    if (model.contextWindow >= floor) {
      if (isPureFloorEntry(current, floor)) merged = omitKey(merged, model.id);
      continue;
    }
    if (entryWindow(current) >= floor) continue;
    merged[model.id] = { ...current, contextWindow: floor };
  }
  return merged;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function entryWindow(entry: Record<string, unknown> | undefined): number {
  const window = entry?.["contextWindow"];
  return typeof window === "number" ? window : -1;
}

function isPureFloorEntry(entry: Record<string, unknown> | undefined, floor: number): boolean {
  return entry !== undefined && Object.keys(entry).length === 1 && entry["contextWindow"] === floor;
}

function omitKey(map: OverrideMap, key: string): OverrideMap {
  const { [key]: _omitted, ...rest } = map;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCatalogModels(store: unknown, provider: string): CatalogModel[] {
  if (!isRecord(store)) return [];
  const entry = store[provider];
  if (!isRecord(entry) || !Array.isArray(entry["models"])) return [];
  return entry["models"].filter(isRecord) as CatalogModel[];
}

function main(): void {
  const store = JSON.parse(readFileSync(catalogStorePath, "utf8")) as unknown;
  const tracked = JSON.parse(readFileSync(trackedOverridesPath, "utf8")) as Record<string, unknown>;

  const catalogModels = readCatalogModels(store, PROVIDER);
  const providers = isRecord(tracked["providers"]) ? tracked["providers"] : {};
  const providerEntry = isRecord(providers[PROVIDER]) ? providers[PROVIDER] : {};
  const existing = isRecord(providerEntry["modelOverrides"]) ? providerEntry["modelOverrides"] : {};

  const raised = applyContextFloor(existing, catalogModels, CONTEXT_FLOOR);
  const added = Object.keys(raised).filter((id) => !(id in existing)).length;

  const mergedProviders = {
    ...providers,
    [PROVIDER]: { ...providerEntry, modelOverrides: raised },
  };
  writeFileSync(
    trackedOverridesPath,
    `${JSON.stringify({ providers: mergedProviders }, null, 2)}\n`,
  );
  console.log(
    `hf-context-floor: ${String(added)} overrides added, ${String(Object.keys(raised).length)} total for ${PROVIDER}.`,
  );
  console.log("Now run: node scripts/sync-settings.ts sync");
}

if (import.meta.main) {
  main();
}
