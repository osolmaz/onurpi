/**
 * The over-cap rule.
 *
 * Two sessions can sweep and claim in the same instant, so the working count can pass the cap by
 * one. Every session then re-checks and the rule below picks one victim. The rule depends only on
 * the lease list, so every session picks the same victim without talking to the others.
 *
 * The default prefers the newest holder, because established work should continue and the session
 * that just started should yield.
 */

import type { VictimPolicy } from "./config.ts";
import type { Lease } from "./store.ts";

export type ConvergeInput = {
  live: readonly Lease[];
  sessionId: string;
  maxAgents: number;
  policy: VictimPolicy;
};

export type ConvergeDecision =
  | { action: "keep" }
  | { action: "stop-self" }
  | { action: "request-stop"; victim: Lease };

/**
 * Order holders from the one that should continue longest to the one that should yield first. Ties
 * break on the session id, so the order never depends on directory listing order.
 */
function yieldOrder(live: readonly Lease[], policy: VictimPolicy): Lease[] {
  const sorted = [...live].sort((left, right) => {
    const byTime = left.admittedAt.localeCompare(right.admittedAt);
    if (byTime !== 0) return byTime;
    return left.sessionId.localeCompare(right.sessionId);
  });
  return policy === "oldest" ? sorted : sorted.reverse();
}

export function decideConvergence(input: ConvergeInput): ConvergeDecision {
  if (input.live.length <= input.maxAgents) return { action: "keep" };
  const victim = yieldOrder(input.live, input.policy)[0];
  if (victim === undefined) return { action: "keep" };
  if (victim.sessionId === input.sessionId) return { action: "stop-self" };
  return { action: "request-stop", victim };
}
