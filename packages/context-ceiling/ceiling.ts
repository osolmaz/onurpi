/**
 * Ceiling state and trigger decision, kept free of the extension API for testing.
 *
 * The ceiling bounds how much conversation context a session accumulates, regardless of the
 * selected model's window: when the estimated context token count passes the ceiling, the
 * extension asks Pi to compact. It is enabled at the default ceiling on every session start and
 * can be toggled or retargeted from the `/context-ceiling` command without touching settings.
 */

export const DEFAULT_CEILING_TOKENS = 272_000;

export interface ContextUsageSample {
  tokens: number | null;
}

export type CompactRequest = "none" | "requested";

export interface CeilingState {
  enabled: boolean;
  ceilingTokens: number;
  /** True while a requested compaction is still running, so a slow one is not re-requested. */
  compactionInFlight: boolean;
}

export function createCeilingState(ceilingTokens: number = DEFAULT_CEILING_TOKENS): CeilingState {
  return { enabled: true, ceilingTokens, compactionInFlight: false };
}

/**
 * Decide whether the current sample should trigger compaction. Unknown token counts (null, e.g.
 * right after a compaction) never trigger, and a compaction is not re-requested while one runs.
 */
export function requestCompaction(state: CeilingState, usage: ContextUsageSample): CompactRequest {
  if (!state.enabled || state.compactionInFlight) return "none";
  if (usage.tokens === null) return "none";
  return usage.tokens > state.ceilingTokens ? "requested" : "none";
}

export function parseCeilingCommand(
  state: CeilingState,
  args: string,
): { status: string } | { state: CeilingState } {
  const argument = args.trim().toLowerCase();
  if (argument === "" || argument === "status") {
    return { status: describe(state) };
  }
  if (argument === "on") {
    return { state: { ...state, enabled: true } };
  }
  if (argument === "off") {
    return { state: { ...state, enabled: false } };
  }
  const parsed = Number(argument);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    return {
      status: `${describe(state)} — pass on, off, status, or a token count of 1000 or more`,
    };
  }
  return { state: { ...state, enabled: true, ceilingTokens: parsed } };
}

export function describe(state: CeilingState): string {
  const setting = state.enabled
    ? `on at ${state.ceilingTokens.toLocaleString("en-US")} tokens`
    : "off";
  return `Context ceiling ${setting}`;
}
