import { InteractiveMode, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

const REPLAY_METHOD = "renderSessionEntries";

export type ReplayProjection = (entries: BranchEntries) => BranchEntries;
export type RestoreReplayProjection = () => void;

function entryId(entry: BranchEntry): string | undefined {
  const id: unknown = Reflect.get(entry, "id");
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function entryIdSet(entries: BranchEntries): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = entryId(entry);
    if (id) ids.add(id);
  }
  return ids;
}

export function newestCompactionEntryId(branch: BranchEntries): string | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "compaction") return entryId(entry);
  }
  return undefined;
}

/**
 * Selects the entries Pi replays. Entries Pi already offers keep their order and are dropped when
 * the compact projection hides them. Projected entries Pi did not offer are added in front of them,
 * which keeps older compaction windows in the transcript. Pi renders the newest compaction entry
 * itself when it rebuilds the transcript after a compaction, so an omitted newest compaction entry
 * stays out of the added older entries.
 */
export function projectedReplayEntries(
  given: BranchEntries,
  displayEntries: BranchEntries,
  branch: BranchEntries,
): BranchEntries {
  const displayIds = entryIdSet(displayEntries);
  if (displayIds.size === 0) return given;

  const givenIds = entryIdSet(given);
  const newestCompactionId = newestCompactionEntryId(branch);
  const omittedCompactionId =
    newestCompactionId !== undefined && !givenIds.has(newestCompactionId)
      ? newestCompactionId
      : undefined;

  const added = displayEntries.filter((entry) => {
    const id = entryId(entry);
    return id !== undefined && !givenIds.has(id) && id !== omittedCompactionId;
  });
  const kept = given.filter((entry) => {
    const id = entryId(entry);
    return id === undefined || displayIds.has(id);
  });
  return [...added, ...kept];
}

export function replayProjectionMethod(target: object = InteractiveMode.prototype): unknown {
  return Reflect.get(target, REPLAY_METHOD);
}

export function supportsReplayProjection(target: object = InteractiveMode.prototype): boolean {
  return typeof replayProjectionMethod(target) === "function";
}

type Installation = {
  getProjection: () => ReplayProjection | undefined;
  onError: (error: Error) => void;
  reported: boolean;
};

type ReplayTargetState = {
  installations: Installation[];
  original: (this: unknown, ...args: readonly unknown[]) => unknown;
  patched: (this: unknown, ...args: readonly unknown[]) => unknown;
};

const targetStates = new WeakMap<object, ReplayTargetState>();

function removeInstallation(
  target: object,
  state: ReplayTargetState,
  installation: Installation,
): void {
  const index = state.installations.indexOf(installation);
  if (index >= 0) state.installations.splice(index, 1);
  if (state.installations.length > 0) return;
  if (Reflect.get(target, REPLAY_METHOD) === state.patched) {
    Reflect.set(target, REPLAY_METHOD, state.original);
  }
  targetStates.delete(target);
}

/**
 * Installs the compact projection on Pi's transcript replay entry point. A target carries at most one
 * wrapper, which always uses the newest installed projection. Each returned function removes its own
 * projection, and the last removal restores the exact method the first installation replaced. A
 * projection failure reports once per installation and replays Pi's own entry list unchanged, so the
 * transcript still renders and the session stays alive.
 */
export function installReplayProjection(
  getProjection: () => ReplayProjection | undefined,
  onError: (error: Error) => void,
  target: object = InteractiveMode.prototype,
): RestoreReplayProjection {
  const installation: Installation = { getProjection, onError, reported: false };
  const existing = targetStates.get(target);
  if (existing) {
    existing.installations.push(installation);
    return () => {
      removeInstallation(target, existing, installation);
    };
  }

  const original = replayProjectionMethod(target);
  if (typeof original !== "function") {
    throw new Error("Pi does not expose the transcript replay entry point");
  }
  const callable = original as (this: unknown, ...args: readonly unknown[]) => unknown;
  const state: ReplayTargetState = {
    installations: [installation],
    original: callable,
    patched: () => undefined,
  };
  state.patched = function (this: unknown, ...args: readonly unknown[]): unknown {
    const entries = args[0] as BranchEntries;
    const rest = args.slice(1);
    const active = state.installations.at(-1);
    let selected = entries;
    if (active) {
      try {
        const projection = active.getProjection();
        if (projection) selected = projection(entries);
      } catch (error) {
        if (!active.reported) {
          active.reported = true;
          active.onError(error instanceof Error ? error : new Error(String(error)));
        }
        selected = entries;
      }
    }
    return Reflect.apply(state.original, this, [selected, ...rest]);
  };

  Reflect.set(target, REPLAY_METHOD, state.patched);
  targetStates.set(target, state);
  return () => {
    removeInstallation(target, state, installation);
  };
}
