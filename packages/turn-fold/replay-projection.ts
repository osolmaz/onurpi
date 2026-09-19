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

/**
 * Installs the compact projection on Pi's transcript replay entry point. The returned function
 * restores the exact method it replaced. A projection failure reports once and replays Pi's own
 * entry list unchanged, so the transcript still renders and the session stays alive.
 */
export function installReplayProjection(
  getProjection: () => ReplayProjection | undefined,
  onError: (error: Error) => void,
  target: object = InteractiveMode.prototype,
): RestoreReplayProjection {
  const original = replayProjectionMethod(target);
  if (typeof original !== "function") {
    throw new Error("Pi does not expose the transcript replay entry point");
  }
  let reported = false;
  const patched = function (
    this: unknown,
    entries: BranchEntries,
    ...rest: readonly unknown[]
  ): unknown {
    let selected = entries;
    const projection = getProjection();
    if (projection) {
      try {
        selected = projection(entries);
      } catch (error) {
        if (!reported) {
          reported = true;
          onError(error instanceof Error ? error : new Error(String(error)));
        }
        selected = entries;
      }
    }
    return Reflect.apply(original, this, [selected, ...rest]);
  };

  Reflect.set(target, REPLAY_METHOD, patched);
  return () => {
    if (Reflect.get(target, REPLAY_METHOD) === patched)
      Reflect.set(target, REPLAY_METHOD, original);
  };
}
