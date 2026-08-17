import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function backupPath(destination: string): string {
  return join(dirname(destination), `.${basename(destination)}.onurpi-backup`);
}

export function recoverDirectoryReplacement(destination: string): void {
  const backup = backupPath(destination);
  if (!existsSync(backup)) return;
  if (existsSync(destination)) rmSync(backup, { force: true, recursive: true });
  else renameSync(backup, destination);
}

export function replaceDirectory(staged: string, destination: string): void {
  recoverDirectoryReplacement(destination);
  const backup = backupPath(destination);
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
