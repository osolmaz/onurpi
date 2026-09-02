import { resolve } from "node:path";

import { shellKind } from "./shell.ts";
import type { CommandContext } from "./types.ts";

export function defaultShell(environment: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") return environment["COMSPEC"] ?? "powershell";
  return environment["SHELL"] ?? "bash";
}

export function commandContext(input: {
  command: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  shell?: string;
}): CommandContext {
  const environment = input.environment ?? process.env;
  const shell = input.shell ?? defaultShell(environment);
  return {
    command: input.command,
    cwd: resolve(input.cwd),
    environment,
    shell,
    shellKind: shellKind(shell),
  };
}
