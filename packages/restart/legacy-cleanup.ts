import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_ENTRYPOINT = fileURLToPath(new URL("./bin/pi.ts", import.meta.url));
const ZSH_BLOCK = `# >>> onurpi restart-aware pi >>>
unalias pi 2>/dev/null
function pi {
  "$HOME/.local/bin/pi" "$@"
}
# <<< onurpi restart-aware pi <<<
`;

export type CleanupResult = "removed" | "restored" | "unchanged";

function linkSource(target: string): string | undefined {
  try {
    if (!lstatSync(target).isSymbolicLink()) return undefined;
    const source = readlinkSync(target);
    return isAbsolute(source) ? source : resolve(dirname(target), source);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isManagedLauncher(source: string, launcher: string): boolean {
  return source === launcher || source.endsWith("/packages/restart/bin/pi.ts");
}

function coInstalledPiEntrypoint(baseUrl = import.meta.url): string | undefined {
  const packageJson = findPackageJSON("@earendil-works/pi-coding-agent", baseUrl);
  return packageJson ? join(dirname(packageJson), "dist", "cli.js") : undefined;
}

function replaceLink(target: string, source: string): void {
  const temporary = `${target}.onurpi-cleanup-${String(process.pid)}`;
  rmSync(temporary, { force: true });
  try {
    symlinkSync(relative(dirname(target), source), temporary);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreLegacyPiBridgeAt(
  launcher: string,
  upstream: string | undefined,
  target: string,
  platform: NodeJS.Platform,
): CleanupResult {
  if (platform !== "linux" || !upstream) return "unchanged";
  const source = linkSource(target);
  if (!source || !isManagedLauncher(source, launcher)) return "unchanged";
  accessSync(upstream, constants.X_OK);
  if (!statSync(upstream).isFile()) throw new Error(`Upstream Pi CLI is not a file: ${upstream}.`);
  replaceLink(target, realpathSync(upstream));
  return "restored";
}

export function restoreLegacyPiBridge(
  launcher = LAUNCHER_ENTRYPOINT,
  upstream = coInstalledPiEntrypoint(),
  target = join(dirname(process.execPath), "pi"),
  platform = process.platform,
): CleanupResult {
  return restoreLegacyPiBridgeAt(launcher, upstream, target, platform);
}

function configDestination(target: string): string | undefined {
  try {
    const status = lstatSync(target);
    if (status.isFile()) return target;
    if (!status.isSymbolicLink()) throw new Error(`Zsh configuration is not a file: ${target}.`);
    try {
      return realpathSync(target);
    } catch (error) {
      throw new Error(`Refusing to replace a dangling Zsh configuration link: ${target}.`, {
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function writeTextAtomically(target: string, content: string): void {
  const temporary = `${target}.onurpi-cleanup-${String(process.pid)}`;
  rmSync(temporary, { force: true });
  try {
    writeFileSync(temporary, content, { mode: statSync(target).mode });
    chmodSync(temporary, statSync(target).mode);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function removeLegacyZshOverride(
  homeDirectory: string,
  platform = process.platform,
): CleanupResult {
  if (platform !== "linux") return "unchanged";
  const target = join(homeDirectory, ".zshrc");
  const destination = configDestination(target);
  if (!destination) return "unchanged";
  const current = readFileSync(destination, "utf8");
  const first = current.indexOf(ZSH_BLOCK);
  if (first === -1) return "unchanged";
  if (current.includes(ZSH_BLOCK, first + ZSH_BLOCK.length)) {
    throw new Error("Refusing to remove duplicate restart-aware pi blocks from .zshrc.");
  }
  const prefixStart = first > 0 && current[first - 1] === "\n" ? first - 1 : first;
  writeTextAtomically(
    destination,
    `${current.slice(0, prefixStart)}${current.slice(first + ZSH_BLOCK.length)}`,
  );
  return "removed";
}
