/**
 * In-memory state for the check. Nothing here calls Pi APIs or touches the disk, so a
 * session never persists the state and branching cannot restore a stale approval.
 */
export type PermissionState = { enabled: boolean };

export function createPermissionState(enabled: boolean): PermissionState {
  return { enabled };
}

export function setEnabled(state: PermissionState, enabled: boolean): void {
  state.enabled = enabled;
}

/** Flip the check and report the new state. */
export function toggle(state: PermissionState): boolean {
  state.enabled = !state.enabled;
  return state.enabled;
}
