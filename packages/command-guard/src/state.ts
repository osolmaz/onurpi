/**
 * Session-scoped guard switch.
 *
 * The switch starts enabled in every session and is never persisted: no settings file, environment
 * variable, project setting, or model-visible tool changes it. Only the operator's
 * `/command-guard on|off` command moves it.
 */
export type GuardState = {
  enabled: boolean;
};

export function createGuardState(): GuardState {
  return { enabled: true };
}

export function guardSwitchStatus(state: GuardState): string {
  return state.enabled
    ? "Switch: on. `/command-guard off` turns it off for this session; a restart turns it back on."
    : "Switch: off for this session. `/command-guard on` turns it back on; a restart turns it back on.";
}
