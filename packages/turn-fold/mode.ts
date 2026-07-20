export const TURN_FOLD_MODES = ["compact", "expanded"] as const;

export type TurnFoldMode = (typeof TURN_FOLD_MODES)[number];

export function isTurnFoldMode(value: unknown): value is TurnFoldMode {
  return TURN_FOLD_MODES.some((mode) => mode === value);
}

export function nextTurnFoldMode(mode: TurnFoldMode): TurnFoldMode {
  return mode === "compact" ? "expanded" : "compact";
}
