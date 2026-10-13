import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";

import {
  capProviderModels,
  capWindowForCeiling,
  chatWindowCeiling,
  type CatalogModel,
} from "./cap.ts";
import type { CeilingState } from "./ceiling.ts";

/** One provider this extension has capped, with everything needed to unwind or re-derive it. */
type AppliedCap = {
  /** The provider's model list as it was before the first cap; caps always re-derive from it. */
  originalConfigs: CatalogModel[];
  /** Config another extension had registered for this provider; restored instead of unregister. */
  priorExtensionConfig: ProviderConfig | undefined;
  capWindow: number;
};

type CapRegistry = {
  capProvider(ctx: ExtensionContext, providerId: string, capWindow: number): boolean;
  releaseCap(providerId: string): void;
  get(providerId: string): AppliedCap | undefined;
  providerIds(): string[];
};

/** Registry-level bookkeeping: capture, (re-)register, and unwind one cap per provider. */
function createCapRegistry(pi: ExtensionAPI): CapRegistry {
  const appliedCaps = new Map<string, AppliedCap>();

  /** Clone the provider's full catalog list (chat, image, classifier) for capping and restore. */
  function captureModels(ctx: ExtensionContext, providerId: string): CatalogModel[] {
    return ctx.modelRegistry
      .getAll()
      .filter((model) => model.provider === providerId)
      .map((model) => model as CatalogModel);
  }

  /** Unwind one provider's cap: restore a prior extension config, or unregister ours. */
  function releaseCap(providerId: string): void {
    const applied = appliedCaps.get(providerId);
    if (!applied) return;
    appliedCaps.delete(providerId);
    if (applied.priorExtensionConfig) {
      pi.registerProvider(providerId, applied.priorExtensionConfig);
    } else {
      pi.unregisterProvider(providerId);
    }
  }

  function capProvider(ctx: ExtensionContext, providerId: string, capWindow: number): boolean {
    const applied = appliedCaps.get(providerId);
    if (applied?.capWindow === capWindow) return true;
    const originalConfigs = applied?.originalConfigs ?? captureModels(ctx, providerId);
    const plan = capProviderModels(originalConfigs, capWindow);
    if (!plan) {
      releaseCap(providerId);
      return false;
    }
    const priorExtensionConfig = ctx.modelRegistry.getRegisteredProviderConfig(providerId);
    pi.registerProvider(providerId, { models: plan.configs });
    appliedCaps.set(providerId, { originalConfigs, priorExtensionConfig, capWindow });
    return true;
  }

  return {
    capProvider,
    releaseCap,
    get: (providerId) => appliedCaps.get(providerId),
    providerIds: () => [...appliedCaps.keys()],
  };
}

export type CapApplier = {
  /** Cap the selected model's provider when its original window exceeds the ceiling window. */
  applyCapToModel(ctx: ExtensionContext, selected: ExtensionContext["model"]): Promise<void>;
  /** Re-derive caps for every provider capped at a previous level, except the selected one. */
  capOtherProviders(ctx: ExtensionContext, selectedProvider: string | undefined): void;
  /** Unwind every cap, restoring prior extension configs or unregistering ours. */
  restoreCaps(ctx: ExtensionContext): Promise<void>;
};

/**
 * Applies the ceiling as an effective context-window cap through the public provider registry, so
 * Pi's own mid-run compaction fires at the ceiling. Registrations live in memory only.
 */
export function createCapApplier(pi: ExtensionAPI, state: CeilingState): CapApplier {
  const registry = createCapRegistry(pi);

  /**
   * The selected model object can predate the cap (it was chosen or re-applied before the
   * provider was re-registered), so re-apply the registry's object for the same model when it
   * differs from the selection.
   */
  async function reapplySelection(
    ctx: ExtensionContext,
    selected: NonNullable<ExtensionContext["model"]>,
  ): Promise<void> {
    const fresh = ctx.modelRegistry.find(selected.provider, selected.id);
    if (!fresh || fresh === selected) return;
    const applied = await pi.setModel(fresh);
    if (!applied) {
      ctx.ui.notify(
        `context ceiling: could not re-apply ${selected.id}; mid-run compaction starts after the next model selection`,
        "warning",
      );
    }
  }

  async function uncapIfApplied(
    ctx: ExtensionContext,
    selected: NonNullable<ExtensionContext["model"]>,
    providerId: string,
  ): Promise<void> {
    if (!registry.get(providerId)) return;
    registry.releaseCap(providerId);
    await reapplySelection(ctx, selected);
  }

  async function ensureCapped(
    ctx: ExtensionContext,
    selected: NonNullable<ExtensionContext["model"]>,
    capWindow: number,
  ): Promise<void> {
    if (registry.get(selected.provider)?.capWindow === capWindow) {
      await reapplySelection(ctx, selected);
      return;
    }
    if (registry.capProvider(ctx, selected.provider, capWindow)) {
      await reapplySelection(ctx, selected);
    }
  }

  async function applyCapToModel(
    ctx: ExtensionContext,
    selected: ExtensionContext["model"],
  ): Promise<void> {
    if (!state.enabled || !selected) return;
    const capWindow = capWindowForCeiling(state.ceilingTokens);
    const applied = registry.get(selected.provider);
    const originalWindow = Math.max(
      selected.contextWindow,
      chatWindowCeiling(applied?.originalConfigs),
    );
    if (originalWindow <= capWindow) {
      await uncapIfApplied(ctx, selected, selected.provider);
      return;
    }
    await ensureCapped(ctx, selected, capWindow);
  }

  function capOtherProviders(ctx: ExtensionContext, selectedProvider: string | undefined): void {
    const capWindow = capWindowForCeiling(state.ceilingTokens);
    for (const providerId of registry.providerIds()) {
      if (providerId !== selectedProvider) registry.capProvider(ctx, providerId, capWindow);
    }
  }

  async function restoreCaps(ctx: ExtensionContext): Promise<void> {
    for (const providerId of registry.providerIds()) registry.releaseCap(providerId);
    const selected = ctx.model;
    if (!selected) return;
    await reapplySelection(ctx, selected);
  }

  return { applyCapToModel, capOtherProviders, restoreCaps };
}
