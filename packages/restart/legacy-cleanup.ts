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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activeNodePiEntrypoint(target: string): string | undefined {
  const packageJson = resolve(
    dirname(target),
    "../lib/node_modules/@earendil-works/pi-coding-agent/package.json",
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(packageJson, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!isRecord(manifest) || !isRecord(manifest["bin"])) return undefined;
  const entrypoint = manifest["bin"]["pi"];
  return typeof entrypoint === "string" ? resolve(dirname(packageJson), entrypoint) : undefined;
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
  upstream = "",
  target = join(dirname(process.execPath), "pi"),
  platform = process.platform,
): CleanupResult {
  return restoreLegacyPiBridgeAt(
    launcher,
    upstream || activeNodePiEntrypoint(target),
    target,
    platform,
  );
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

function withoutLegacyZshBlock(current: string): string | undefined {
  const first = current.indexOf(ZSH_BLOCK);
  if (first === -1) return undefined;
  if (current.includes(ZSH_BLOCK, first + ZSH_BLOCK.length)) {
    throw new Error("Refusing to remove duplicate restart-aware pi blocks from .zshrc.");
  }
  let before = current.slice(0, first);
  const after = current.slice(first + ZSH_BLOCK.length);
  if (before.endsWith("\n\n")) before = before.slice(0, -1);
  if (before.length > 0 && after.length > 0 && !before.endsWith("\n")) before = `${before}\n`;
  return `${before}${after}`;
}

export function removeLegacyZshOverride(
  homeDirectory: string,
  platform = process.platform,
): CleanupResult {
  if (platform !== "linux") return "unchanged";
  const destination = configDestination(join(homeDirectory, ".zshrc"));
  if (!destination) return "unchanged";
  const updated = withoutLegacyZshBlock(readFileSync(destination, "utf8"));
  if (updated === undefined) return "unchanged";
  writeTextAtomically(destination, updated);
  return "removed";
}
