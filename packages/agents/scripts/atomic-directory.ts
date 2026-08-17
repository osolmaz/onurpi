import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

export function replaceDirectory(
  staged: string,
  destination: string,
  workingDirectory: string,
): void {
  const backup = join(workingDirectory, ".previous");
  const hadDestination = existsSync(destination);
  if (hadDestination) renameSync(destination, backup);
  try {
    renameSync(staged, destination);
  } catch (error) {
    if (hadDestination && existsSync(backup) && !existsSync(destination)) {
      renameSync(backup, destination);
    }
    throw error;
  }
  if (hadDestination) rmSync(backup, { force: true, recursive: true });
}
