import type { DestructiveKind, DestructiveOperation, ResolvedWord } from "./types.ts";

export function operation(
  command: string,
  kind: DestructiveKind,
  source: string,
  targets: readonly ResolvedWord[],
): DestructiveOperation {
  return { command, kind, source, targets };
}
