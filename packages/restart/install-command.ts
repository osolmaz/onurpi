import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeLegacyZshOverride, restoreLegacyPiBridge } from "./legacy-cleanup.ts";

const LAUNCHER_ENTRYPOINT = fileURLToPath(new URL("./bin/pi.ts", import.meta.url));

export type InstallResult = {
  status: "installed" | "current" | "unsupported";
  target: string;
};

type TargetState = { kind: "missing" | "other" } | { kind: "link"; source: string };

function targetState(target: string): TargetState {
  try {
    if (!lstatSync(target).isSymbolicLink()) return { kind: "other" };
    const value = readlinkSync(target);
    const source = isAbsolute(value) ? value : resolve(dirname(target), value);
    return { kind: "link", source };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
}

function isManagedLink(linkTarget: string, source: string): boolean {
  return linkTarget === source || linkTarget.endsWith("/packages/restart/bin/pi.ts");
}

function validateSource(source: string): void {
  accessSync(source, constants.X_OK);
  if (!statSync(source).isFile()) throw new Error(`Pi launcher is not a file: ${source}.`);
}

function validateTarget(target: string, source: string): "current" | "install" {
  const existing = targetState(target);
  if (existing.kind === "missing") return "install";
  if (existing.kind === "link" && existing.source === source) return "current";
  if (existing.kind === "link" && isManagedLink(existing.source, source)) return "install";
  throw new Error(`Refusing to replace unmanaged command at ${target}.`);
}

function writeLink(target: string, source: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.onurpi-${String(process.pid)}`;
  rmSync(temporary, { force: true });
  try {
    symlinkSync(source, temporary);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function installPiCommand(
  homeDirectory = homedir(),
  source = LAUNCHER_ENTRYPOINT,
  platform = process.platform,
): InstallResult {
  const target = join(homeDirectory, ".local", "bin", "pi");
  if (platform !== "linux") return { status: "unsupported", target };
  validateSource(source);
  if (validateTarget(target, source) === "current") return { status: "current", target };
  writeLink(target, source);
  return { status: "installed", target };
}

function main(): void {
  const result = installPiCommand();
  if (result.status === "unsupported") {
    process.stdout.write("Skipped the restart-aware pi command on an untested platform.\n");
    return;
  }
  restoreLegacyPiBridge();
  removeLegacyZshOverride(homedir());
  process.stdout.write(
    result.status === "current"
      ? `Restart-aware pi command is current at ${result.target}.\n`
      : `Installed restart-aware pi command at ${result.target}.\n`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main();
