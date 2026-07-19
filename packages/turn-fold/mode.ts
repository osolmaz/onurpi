export const TURN_FOLD_MODES = ["final-only", "live", "expanded"] as const;

export type TurnFoldMode = (typeof TURN_FOLD_MODES)[number];

export function isTurnFoldMode(value: unknown): value is TurnFoldMode {
  return TURN_FOLD_MODES.some((mode) => mode === value);
}

export function nextTurnFoldMode(mode: TurnFoldMode): TurnFoldMode {
  switch (mode) {
    case "final-only":
      return "live";
    case "live":
      return "expanded";
    case "expanded":
      return "final-only";
  }
}
