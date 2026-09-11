/**
 * Per-model override handling for the tracked `model-overrides.json` copy.
 *
 * `~/.pi/agent/models.json` also holds machine-local endpoints, API keys, and model lists. Only the
 * `providers.<name>.modelOverrides` maps are reviewed configuration, so those are the only part that
 * travels between the live file and this repository.
 */

export type ModelOverrideEntry = { modelOverrides: Record<string, unknown> };
export type ModelOverrides = { providers: Record<string, ModelOverrideEntry> };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isModelOverrides(value: unknown): value is ModelOverrides {
  if (!isRecord(value)) return false;
  const providers = value["providers"];
  if (!isRecord(providers)) return false;
  return Object.values(providers).every(
    (entry) => isRecord(entry) && isRecord(entry["modelOverrides"]),
  );
}

/** Copy only the reviewed per-model overrides out of a machine-local models.json. */
export function extractModelOverrides(liveModels: unknown): ModelOverrides {
  const liveProviders = isRecord(liveModels) ? liveModels["providers"] : undefined;
  const providers = isRecord(liveProviders) ? liveProviders : {};

  const collected: Record<string, ModelOverrideEntry> = {};
  for (const [name, provider] of Object.entries(providers)) {
    if (!isRecord(provider)) continue;
    const overrides = provider["modelOverrides"];
    if (!isRecord(overrides) || Object.keys(overrides).length === 0) continue;
    collected[name] = { modelOverrides: overrides };
  }
  return { providers: collected };
}

/** Merge tracked overrides onto a live models.json without touching anything else. */
export function applyModelOverrides(
  liveModels: unknown,
  tracked: ModelOverrides,
  sourceLabel = "models.json",
): Record<string, unknown> {
  if (!isRecord(liveModels)) throw new Error(`No object in ${sourceLabel}`);

  const liveProviders = liveModels["providers"];
  const providers: Record<string, unknown> = isRecord(liveProviders) ? { ...liveProviders } : {};

  for (const [name, entry] of Object.entries(tracked.providers)) {
    const existing = providers[name];
    const provider: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
    provider["modelOverrides"] = entry.modelOverrides;
    providers[name] = provider;
  }
  return { ...liveModels, providers };
}
