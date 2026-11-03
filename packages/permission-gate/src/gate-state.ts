/**
 * In-memory state for the approval gate. Nothing here calls Pi APIs or touches the disk, so a
 * session never persists the gate state and branching cannot restore a stale approval.
 */
export type GateState = { enabled: boolean };

export function createGateState(enabled: boolean): GateState {
  return { enabled };
}

export function setGateEnabled(state: GateState, enabled: boolean): void {
  state.enabled = enabled;
}

/** Flip the gate and report the new state. */
export function toggleGate(state: GateState): boolean {
  state.enabled = !state.enabled;
  return state.enabled;
}
