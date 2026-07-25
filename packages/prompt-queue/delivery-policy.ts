export type HoldReason = "abort" | "error";
export type TurnOutcome = "completed" | HoldReason | undefined;

export type DeliveryGate = {
  /** The manager window is open; the user is editing the queue. */
  windowOpen: boolean;
  /** Why automatic delivery is held until the user re-engages. */
  holdReason: HoldReason | undefined;
};

export type QueueSnapshot = {
  hasSteer: boolean;
  hasAny: boolean;
};

export type DeliveryDecision = "deliver-steer" | "deliver-next" | "none";
export type SettledDecision = "deliver-next" | "hold-abort" | "hold-error" | "none";
export type SendNowDecision = "send" | "abort-and-send-on-settle";

function gateClosed(gate: DeliveryGate): boolean {
  return gate.windowOpen || gate.holdReason !== undefined;
}

/** Convert Pi's structured assistant stop reason into queue lifecycle state. */
export function turnOutcome(stopReason: string | undefined): TurnOutcome {
  if (stopReason === "aborted") return "abort";
  if (stopReason === "error") return "error";
  return stopReason === undefined ? undefined : "completed";
}

/** Deliver directly while idle, or abort an active run and send as soon as it settles. */
export function decideSendNow(isIdle: boolean): SendNowDecision {
  return isIdle ? "send" : "abort-and-send-on-settle";
}

/**
 * At a turn boundary a pending steer item can be injected before the next
 * LLM call. Aborted or errored turns must not trigger delivery: queueing a
 * message there would silently restart a run the user just stopped.
 */
export function decideTurnEndDelivery(
  gate: DeliveryGate,
  snapshot: QueueSnapshot,
  outcome: TurnOutcome,
): DeliveryDecision {
  if (gateClosed(gate)) return "none";
  if (outcome === "abort" || outcome === "error") return "none";
  return snapshot.hasSteer ? "deliver-steer" : "none";
}

/**
 * Once the agent fully settles, a final error or abort holds the queue. This
 * check happens at settlement rather than the first errored turn so Pi can
 * exhaust its automatic retries without unnecessarily pausing delivery.
 * Otherwise the next pending item becomes a fresh prompt.
 */
export function decideSettledDelivery(
  gate: DeliveryGate,
  snapshot: QueueSnapshot,
  finalOutcome: TurnOutcome,
): SettledDecision {
  if (!snapshot.hasAny) return "none";
  if (finalOutcome === "error") return "hold-error";
  if (finalOutcome === "abort") return "hold-abort";
  if (gateClosed(gate)) return "none";
  return "deliver-next";
}
