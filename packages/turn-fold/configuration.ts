import type { TranscriptDensity } from "./density.ts";
import { isTranscriptDensity } from "./density.ts";
import {
  DEFAULT_TRANSCRIPT_WINDOWS,
  isTranscriptWindowValue,
  type TranscriptWindowValue,
} from "./transcript-windows.ts";
import { isPreCompactionVisibility, type PreCompactionVisibility } from "./history-scope.ts";

export const TURN_FOLD_CONFIG_ENTRY = "onurpi-turn-fold-config";

export type TurnFoldConfiguration = Readonly<{
  density: TranscriptDensity;
  preCompaction: PreCompactionVisibility;
  windows: TranscriptWindowValue;
}>;

export const DEFAULT_TURN_FOLD_CONFIGURATION: TurnFoldConfiguration = {
  density: "compact",
  preCompaction: "show",
  windows: DEFAULT_TRANSCRIPT_WINDOWS,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export function isTurnFoldConfiguration(value: unknown): value is TurnFoldConfiguration {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    keys.every((key) => key === "density" || key === "preCompaction" || key === "windows") &&
    isTranscriptDensity(value["density"]) &&
    isPreCompactionVisibility(value["preCompaction"]) &&
    isTranscriptWindowValue(value["windows"])
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
