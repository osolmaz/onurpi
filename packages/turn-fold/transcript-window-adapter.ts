import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { selectTranscriptEntries, type TranscriptWindowValue } from "./transcript-windows.ts";

const ADAPTER_STATE_KEY = Symbol.for("@onurpi/turn-fold/transcript-window-adapter.v1");

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

export type TranscriptSessionManager = {
  buildContextEntries: () => BranchEntries;
  readonly getBranch: () => BranchEntries;
};

export type TranscriptProjector = (entries: BranchEntries) => BranchEntries;

export type TranscriptWindowAdapter = {
  getValue: () => TranscriptWindowValue;
  markPendingCompaction: (entryId: string) => void;
  restore: () => void;
  setProjector: (projector: TranscriptProjector, onError?: (error: Error) => void) => void;
  setValue: (value: TranscriptWindowValue) => void;
};

type AdapterState = TranscriptWindowAdapter & {
  readonly buildEntries: () => BranchEntries;
};

function isAdapterState(value: unknown): value is AdapterState {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "buildEntries") === "function" &&
    typeof Reflect.get(value, "getValue") === "function" &&
    typeof Reflect.get(value, "markPendingCompaction") === "function" &&
    typeof Reflect.get(value, "restore") === "function" &&
    typeof Reflect.get(value, "setProjector") === "function" &&
    typeof Reflect.get(value, "setValue") === "function"
  );
}

function defineAdapterState(manager: object, state: AdapterState): void {
  if (
    !Reflect.defineProperty(manager, ADAPTER_STATE_KEY, {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    })
  ) {
    throw new Error("Unable to install Turn Fold transcript-window state");
  }
}

function withoutPendingCompaction(
  entries: BranchEntries,
  pendingCompactionEntryId: string | undefined,
): BranchEntries {
  if (!pendingCompactionEntryId) return entries;
  const pendingIndex = entries.findIndex((entry) => entry.id === pendingCompactionEntryId);
  if (pendingIndex < 0) {
    throw new Error(
      `Pending Turn Fold compaction ${pendingCompactionEntryId} is absent from the selected transcript`,
    );
  }
  return [...entries.slice(0, pendingIndex), ...entries.slice(pendingIndex + 1)];
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function installTranscriptWindowAdapter(
  manager: TranscriptSessionManager,
  initialValue: TranscriptWindowValue,
  initialProjector: TranscriptProjector = (entries) => entries,
  initialOnError?: (error: Error) => void,
): TranscriptWindowAdapter {
  const existing: unknown = Reflect.get(manager, ADAPTER_STATE_KEY);
  if (isAdapterState(existing)) {
    existing.setValue(initialValue);
    existing.setProjector(initialProjector, initialOnError);
    manager.buildContextEntries = existing.buildEntries;
    return existing;
  }

  const originalBuildEntries = manager.buildContextEntries;
  let value = initialValue;
  let pendingCompactionEntryId: string | undefined;
  let projector = initialProjector;
  let onError = initialOnError;
  let warned = false;

  const fallback = (): BranchEntries => Reflect.apply(originalBuildEntries, manager, []);
  const state: AdapterState = {
    buildEntries: () => {
      const selected = selectTranscriptEntries(manager.getBranch(), value);
      const pending = pendingCompactionEntryId;
      pendingCompactionEntryId = undefined;
      const source = withoutPendingCompaction(selected, pending);
      try {
        return projector(source);
      } catch (error) {
        if (!warned) {
          warned = true;
          onError?.(errorFrom(error));
        }
        return fallback();
      }
    },
    getValue: () => value,
    markPendingCompaction: (entryId) => {
      if (!entryId) throw new Error("Pending compaction entry ID must not be empty");
      pendingCompactionEntryId = entryId;
    },
    restore: () => {
      if (manager.buildContextEntries === state.buildEntries) {
        manager.buildContextEntries = originalBuildEntries;
      }
    },
    setProjector: (nextProjector, nextOnError) => {
      projector = nextProjector;
      onError = nextOnError;
      warned = false;
    },
    setValue: (nextValue) => {
      value = nextValue;
    },
  };
  defineAdapterState(manager, state);
  manager.buildContextEntries = state.buildEntries;
  return state;
}
