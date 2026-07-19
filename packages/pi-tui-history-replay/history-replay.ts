import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const PATCH_STATE_KEY = Symbol.for("pi.tui-history-replay.chronological-branch.v1");

type SessionManager = ExtensionContext["sessionManager"];
export type BranchEntries = ReturnType<SessionManager["getBranch"]>;

export type TranscriptSessionManager = {
  readonly getBranch: () => BranchEntries;
  buildContextEntries: () => BranchEntries;
};

export type PatchState = {
  pendingCompactionEntryId?: string;
};

export function getPatchState(sessionManager: object): PatchState {
  const existing = Reflect.get(sessionManager, PATCH_STATE_KEY) as PatchState | undefined;
  if (existing) return existing;

  const state: PatchState = {};
  if (
    !Reflect.defineProperty(sessionManager, PATCH_STATE_KEY, {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    })
  ) {
    throw new Error("Unable to persist TUI history replay patch state on SessionManager");
  }
  return state;
}

export function installChronologicalTranscriptPatch(
  sessionManager: TranscriptSessionManager,
): PatchState {
  const state = getPatchState(sessionManager);

  // Pi uses a separate buildSessionContext() path for the LLM. Replacing this
  // rendering path therefore keeps compacted messages out of model context.
  sessionManager.buildContextEntries = () => {
    const branch = sessionManager.getBranch();
    const pendingCompactionEntryId = state.pendingCompactionEntryId;
    if (!pendingCompactionEntryId) return branch;

    const pendingIndex = branch.findIndex((entry) => entry.id === pendingCompactionEntryId);
    if (pendingIndex < 0) {
      throw new Error(
        `Pending TUI compaction entry ${pendingCompactionEntryId} is absent from the active branch`,
      );
    }

    // Pi rebuilds before adding its synthetic live-compaction summary. Omit the
    // persisted entry for that rebuild so the summary appears exactly once.
    delete state.pendingCompactionEntryId;
    return [...branch.slice(0, pendingIndex), ...branch.slice(pendingIndex + 1)];
  };

  return state;
}
