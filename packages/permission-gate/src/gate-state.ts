/**
 * In-memory state for the approval gate. Nothing here calls Pi APIs or touches the disk, so a
 * session never persists the gate state and branching cannot restore a stale approval.
 */
export type GateState = {
  enabled: boolean;
  allowedTools: Set<string>;
  approvedCalls: Set<string>;
};

/** Bound the remembered approvals so a long session cannot grow without limit. */
export const MAX_APPROVED_CALLS = 512;

export function createGateState(enabled: boolean): GateState {
  return { enabled, allowedTools: new Set(), approvedCalls: new Set() };
}

export function setGateEnabled(state: GateState, enabled: boolean): void {
  state.enabled = enabled;
}

/** Flip the gate and report the new state. */
export function toggleGate(state: GateState): boolean {
  state.enabled = !state.enabled;
  return state.enabled;
}

/** Remember a tool name that the user allowed for the rest of the session. */
export function allowToolForSession(state: GateState, toolName: string): void {
  state.allowedTools.add(toolName);
}

/** Remember an approved call so tool calls nested inside it do not ask again. */
export function approveCall(state: GateState, toolCallId: string): void {
  state.approvedCalls.add(toolCallId);
  pruneApprovedCalls(state);
}

export function resetSession(state: GateState): void {
  state.allowedTools.clear();
  state.approvedCalls.clear();
}

function pruneApprovedCalls(state: GateState): void {
  const excess = state.approvedCalls.size - MAX_APPROVED_CALLS;
  if (excess <= 0) return;
  let removed = 0;
  for (const toolCallId of state.approvedCalls) {
    if (removed >= excess) return;
    state.approvedCalls.delete(toolCallId);
    removed += 1;
  }
}
