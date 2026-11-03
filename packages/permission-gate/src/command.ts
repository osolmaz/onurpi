import type { GateState } from "./gate-state.ts";

export type GateCommandAction = "toggle" | "on" | "off" | "status" | "invalid";

export const GATE_USAGE = "Usage: /gate [on|off|status]";

export const GATE_ON_TEXT =
  "Permission gate: on. Pi asks before each call that is not a local read.";
export const GATE_OFF_TEXT =
  "Permission gate: off. Tool calls run without asking. Turn it on with /gate on.";

export function parseGateCommand(args: string): GateCommandAction {
  const words = args
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const first = words[0];
  if (first === undefined) return "toggle";
  if (words.length > 1) return "invalid";
  if (first === "on" || first === "off" || first === "status") return first;
  return "invalid";
}

export function gateStatusText(state: GateState): string {
  return state.enabled ? GATE_ON_TEXT : GATE_OFF_TEXT;
}
