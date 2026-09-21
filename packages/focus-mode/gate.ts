/**
 * The admission decision, isolated from the file system and from Pi.
 *
 * The gate answers one question: may this prompt start a turn now? Everything it needs arrives as
 * an argument, so the rules are directly testable.
 */

import type { Lease } from "./store.ts";

export type InputSource = "interactive" | "rpc" | "extension";

export type GateInput = {
  enabled: boolean;
  /** Whether this session already holds a lease. */
  holdsLease: boolean;
  /** Live leases, including this session's own lease when it holds one. */
  live: readonly Lease[];
  maxAgents: number;
  source: InputSource;
};

export type GateDecision =
  | { action: "continue"; claim: boolean; count: number; max: number }
  | { action: "reject"; count: number; max: number };

export function decideGate(input: GateInput): GateDecision {
  const count = input.live.length;
  if (!input.enabled) return { action: "continue", claim: false, count, max: input.maxAgents };
  // Another package's own text is not user work, so it never claims a slot.
  if (input.source === "extension") {
    return { action: "continue", claim: false, count, max: input.maxAgents };
  }
  // A holder always continues, because its slot is already counted.
  if (input.holdsLease) return { action: "continue", claim: false, count, max: input.maxAgents };
  if (input.live.length < input.maxAgents) {
    return { action: "continue", claim: true, count, max: input.maxAgents };
  }
  return { action: "reject", count, max: input.maxAgents };
}
