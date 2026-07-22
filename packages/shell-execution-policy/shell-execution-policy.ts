import { isToolCallEventType, type ToolCallEvent } from "@earendil-works/pi-coding-agent";

export const DEFAULT_BASH_TIMEOUT_SECONDS = 10;
export const MAX_BASH_TIMEOUT_SECONDS = 120;

export type BashTimeoutInput = {
  timeout?: number;
};

export type BashTimeoutPolicyOutcome = {
  action: "capped" | "defaulted" | "preserved";
  timeout: number;
};

export function applyBashTimeoutPolicy(input: BashTimeoutInput): BashTimeoutPolicyOutcome {
  const requestedTimeout = input.timeout;

  if (requestedTimeout === undefined) {
    input.timeout = DEFAULT_BASH_TIMEOUT_SECONDS;
    return { action: "defaulted", timeout: DEFAULT_BASH_TIMEOUT_SECONDS };
  }

  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    return { action: "preserved", timeout: requestedTimeout };
  }

  if (requestedTimeout > MAX_BASH_TIMEOUT_SECONDS) {
    input.timeout = MAX_BASH_TIMEOUT_SECONDS;
    return { action: "capped", timeout: MAX_BASH_TIMEOUT_SECONDS };
  }

  return { action: "preserved", timeout: requestedTimeout };
}

export function enforceBashToolCallTimeout(
  event: ToolCallEvent,
): BashTimeoutPolicyOutcome | undefined {
  if (!isToolCallEventType("bash", event)) return undefined;
  return applyBashTimeoutPolicy(event.input);
}
