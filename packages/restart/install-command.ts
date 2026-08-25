import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { coInstalledPiEntrypoint } from "./pi-package.ts";

const LAUNCHER_ENTRYPOINT = fileURLToPath(new URL("./bin/pi.ts", import.meta.url));
const ZSH_BLOCK_START = "# >>> onurpi restart-aware pi >>>";
const ZSH_BLOCK_END = "# <<< onurpi restart-aware pi <<<";
const ZSH_BLOCK = `${ZSH_BLOCK_START}
unalias pi 2>/dev/null
function pi {
  "$HOME/.local/bin/pi" "$@"
}
${ZSH_BLOCK_END}
`;

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

function resolvesToSameFile(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function installActivePiBridgeAt(
  source: string,
  upstream: string,
  target: string,
  platform: NodeJS.Platform,
): InstallResult {
  if (platform !== "linux") return { status: "unsupported", target };
  validateSource(source);
  validateSource(upstream);
  const existing = targetState(target);
  if (existing.kind !== "link") return { status: "unsupported", target };
  if (existing.source === source) return { status: "current", target };
  if (isManagedLink(existing.source, source)) {
    writeLink(target, source);
    return { status: "installed", target };
  }
  if (!resolvesToSameFile(existing.source, upstream)) return { status: "unsupported", target };
  writeLink(target, source);
  return { status: "installed", target };
}

export function installActivePiBridge(
  source = LAUNCHER_ENTRYPOINT,
  upstream = coInstalledPiEntrypoint(),
  target = join(dirname(process.execPath), "pi"),
  platform = process.platform,
): InstallResult {
  return installActivePiBridgeAt(source, upstream, target, platform);
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

type ManagedBlockRange = { start: number; end: number };

function onlyMarkerIndex(current: string, marker: string): number | undefined {
  const first = current.indexOf(marker);
  if (first === -1) return undefined;
  if (current.includes(marker, first + marker.length)) {
    throw new Error("Refusing to replace duplicate restart-aware pi blocks in .zshrc.");
  }
  return first;
}

function managedBlockRange(current: string): ManagedBlockRange | undefined {
  const start = onlyMarkerIndex(current, ZSH_BLOCK_START);
  const endMarker = onlyMarkerIndex(current, ZSH_BLOCK_END);
  if (start === undefined && endMarker === undefined) return undefined;
  if (start === undefined || endMarker === undefined || endMarker < start) {
    throw new Error("Refusing to replace a malformed restart-aware pi block in .zshrc.");
  }
  const afterMarker = endMarker + ZSH_BLOCK_END.length;
  const end = current[afterMarker] === "\n" ? afterMarker + 1 : afterMarker;
  return { start, end };
}

function appendedZshConfig(current: string): string {
  if (current.length === 0) return ZSH_BLOCK;
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${ZSH_BLOCK}`;
}

function updatedZshConfig(current: string): string | undefined {
  const range = managedBlockRange(current);
  if (!range) return appendedZshConfig(current);
  if (current.slice(range.start, range.end) === ZSH_BLOCK) return undefined;
  return `${current.slice(0, range.start)}${ZSH_BLOCK}${current.slice(range.end)}`;
}

function existingConfigStatus(target: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function resolvedConfigLink(target: string): string {
  try {
    return realpathSync(target);
  } catch (error) {
    throw new Error(`Refusing to replace a dangling Zsh configuration link: ${target}.`, {
      cause: error,
    });
  }
}

function configWritePath(target: string): string {
  const status = existingConfigStatus(target);
  if (!status) return target;
  if (status.isSymbolicLink()) return resolvedConfigLink(target);
  if (status.isFile()) return target;
  throw new Error(`Zsh configuration is not a file: ${target}.`);
}

function writeTextAtomically(target: string, content: string): void {
  const destination = configWritePath(target);
  const temporary = `${destination}.onurpi-${String(process.pid)}`;
  rmSync(temporary, { force: true });
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    try {
      chmodSync(temporary, statSync(destination).mode);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function installZshOverride(
  homeDirectory = homedir(),
  shell = process.env["SHELL"] ?? "",
  platform = process.platform,
): InstallResult {
  const target = join(homeDirectory, ".zshrc");
  if (platform !== "linux" || basename(shell) !== "zsh") {
    return { status: "unsupported", target };
  }
  const updated = updatedZshConfig(readTextOrEmpty(target));
  if (updated === undefined) return { status: "current", target };
  writeTextAtomically(target, updated);
  return { status: "installed", target };
}

function describe(result: InstallResult, name: string): string {
  if (result.status === "unsupported") return `Skipped ${name} on an untested shell or platform.\n`;
  return result.status === "current"
    ? `${name} is current at ${result.target}.\n`
    : `Installed ${name} at ${result.target}.\n`;
}

function main(): void {
  process.stdout.write(describe(installPiCommand(), "Restart-aware pi command"));
  process.stdout.write(describe(installActivePiBridge(), "Active Pi command bridge"));
  process.stdout.write(describe(installZshOverride(), "Restart-aware Zsh override"));
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main();
