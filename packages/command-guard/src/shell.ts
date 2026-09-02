import type { ShellKind } from "./types.ts";

export function shellKind(shell: string): ShellKind {
  const fileName = shell.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  const normalized = fileName.endsWith(".exe") ? fileName.slice(0, -4) : fileName;
  if (["bash", "sh", "zsh", "dash", "ash"].includes(normalized)) return "bash";
  if (["pwsh", "powershell"].includes(normalized)) return "powershell";
  if (normalized === "cmd") return "cmd";
  return "unknown";
}
