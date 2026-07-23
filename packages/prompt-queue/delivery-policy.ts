export type DeliveryGate = {
  /** The manager window is open; the user is editing the queue. */
  windowOpen: boolean;
  /** Delivery was held after an abort until the user re-engages. */
  held: boolean;
};

export type QueueSnapshot = {
  hasSteer: boolean;
  hasAny: boolean;
};

export type DeliveryDecision = "deliver-steer" | "deliver-next" | "none";
export type SendNowDecision = "send" | "abort-and-send-on-settle";

function gateClosed(gate: DeliveryGate): boolean {
  return gate.windowOpen || gate.held;
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
  stopReason: string | undefined,
): DeliveryDecision {
  if (gateClosed(gate)) return "none";
  if (stopReason === "aborted" || stopReason === "error") return "none";
  return snapshot.hasSteer ? "deliver-steer" : "none";
}

/**
 * Once the agent is idle, the next pending item (steer or queued) becomes a
 * fresh prompt. One item per settle keeps delivery one-at-a-time.
 */
export function decideIdleDelivery(gate: DeliveryGate, snapshot: QueueSnapshot): DeliveryDecision {
  if (gateClosed(gate)) return "none";
  return snapshot.hasAny ? "deliver-next" : "none";
}
