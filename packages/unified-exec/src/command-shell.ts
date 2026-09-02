import { IS_WINDOWS, resolveDefaultShell, resolveWindowsShell } from "./shell.ts";

export function resolveCommandShell(
  requested: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (requested && IS_WINDOWS) return resolveWindowsShell(requested, environment);
  if (requested) return requested;
  return resolveDefaultShell(environment).shell;
}
