import { type ExtensionAPI, type Theme, VERSION } from "@earendil-works/pi-coding-agent";

import { installPromptHeaderPatches, type RestorePromptHeaderPatches } from "./patches.ts";

export const SUPPORTED_PI_RANGE = ">=1.5.0";

export function supportsPiVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 1 || (major === 1 && minor >= 5);
}

type HeaderRuntime = { theme: Theme | undefined };

function rememberTheme(runtime: HeaderRuntime, ctx: { ui: { theme: Theme } }): void {
  runtime.theme = ctx.ui.theme;
}

export default function stickyPrompt(pi: ExtensionAPI): void {
  const runtime: HeaderRuntime = { theme: undefined };
  const restore: RestorePromptHeaderPatches = supportsPiVersion(VERSION)
    ? installPromptHeaderPatches(() => runtime.theme)
    : () => undefined;

  pi.on("session_start", (_event, ctx) => {
    rememberTheme(runtime, ctx);
  });
  pi.on("message_update", (_event, ctx) => {
    rememberTheme(runtime, ctx);
  });
  pi.on("tool_execution_start", (_event, ctx) => {
    rememberTheme(runtime, ctx);
  });
  pi.on("turn_start", (_event, ctx) => {
    rememberTheme(runtime, ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    rememberTheme(runtime, ctx);
  });
  pi.on("session_shutdown", () => {
    restore();
  });
}
