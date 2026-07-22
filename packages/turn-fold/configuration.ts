import type { TurnFoldMode } from "./mode.ts";
import { isTurnFoldMode } from "./mode.ts";
import {
  DEFAULT_TRANSCRIPT_WINDOWS,
  isTranscriptWindowValue,
  type TranscriptWindowValue,
} from "./transcript-windows.ts";

export const TURN_FOLD_CONFIG_ENTRY = "onurpi-turn-fold-config";

export type TurnFoldConfiguration = Readonly<{
  mode: TurnFoldMode;
  windows: TranscriptWindowValue;
}>;

export const DEFAULT_TURN_FOLD_CONFIGURATION: TurnFoldConfiguration = {
  mode: "compact",
  windows: DEFAULT_TRANSCRIPT_WINDOWS,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export function isTurnFoldConfiguration(value: unknown): value is TurnFoldConfiguration {
  return (
    isRecord(value) && isTurnFoldMode(value["mode"]) && isTranscriptWindowValue(value["windows"])
  );
}

export function configurationFromBranch(entries: readonly unknown[]): TurnFoldConfiguration {
  let configuration = DEFAULT_TURN_FOLD_CONFIGURATION;
  for (const entry of entries) {
    if (!isRecord(entry) || entry["type"] !== "custom") continue;
    if (entry["customType"] !== TURN_FOLD_CONFIG_ENTRY) continue;
    const data = entry["data"];
    if (isTurnFoldConfiguration(data)) configuration = data;
  }
  return configuration;
}
