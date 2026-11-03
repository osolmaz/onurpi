import type { PermissionState } from "./state.ts";

export type CommandAction = "toggle" | "on" | "off" | "status" | "invalid";

export const USAGE = "Usage: /permissions [on|off|status]";

export const ON_TEXT = "Permissions: on. Pi asks before each call that is not a local read.";
export const OFF_TEXT =
  "Permissions: off. Tool calls run without asking. Turn them on with /permissions on.";

export function parseCommand(args: string): CommandAction {
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

export function statusText(state: PermissionState): string {
  return state.enabled ? ON_TEXT : OFF_TEXT;
}
