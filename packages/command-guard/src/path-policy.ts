import { lstatSync, realpathSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

import type {
  DestructiveOperation,
  ObjectIdentity,
  ResolvedTarget,
  ResolvedWord,
} from "./types.ts";

export type TargetResolution =
  | Readonly<{ ok: true; targets: readonly ResolvedTarget[] }>
  | Readonly<{ ok: false; action: "deny" | "rewrite"; reason: string }>;

type ExistingPath = Readonly<{
  canonicalPath: string;
  identity: ObjectIdentity;
  operandIdentity: ObjectIdentity;
  isMountRoot: boolean;
}>;

const MOUNT_ESCAPES: Readonly<Record<string, string>> = {
  "011": "\t",
  "012": "\n",
  "040": " ",
  "134": "\\",
};

function decodeMountPath(value: string): string {
  return value.replace(
    /\\(011|012|040|134)/gu,
    (_match, code: string) => MOUNT_ESCAPES[code] ?? "",
  );
}

export function parseLinuxMountRoots(source: string): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const line of source.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf(" - ");
    const fields = (separator < 0 ? line : line.slice(0, separator)).split(" ");
    const mountPoint = fields[4];
    if (separator < 0 || !mountPoint) throw new Error("invalid Linux mount table entry");
    roots.add(normalizedForCompare(decodeMountPath(mountPoint)));
  }
  return roots;
}

async function mountedRoots(): Promise<ReadonlySet<string> | undefined> {
  if (process.platform !== "linux") return undefined;
  return parseLinuxMountRoots(await readFile("/proc/self/mountinfo", "utf8"));
}

function identityFromStat(info: Awaited<ReturnType<typeof lstat>>): ObjectIdentity {
  return { device: String(info.dev), inode: String(info.ino) };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function existingPath(path: string): Promise<ExistingPath | undefined> {
  let operandInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    operandInfo = await lstat(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
  } catch (error: unknown) {
    if (isNotFound(error) && operandInfo.isSymbolicLink()) {
      throw new Error(`cannot resolve dangling symlink target: ${path}`);
    }
    throw error;
  }
  const [targetInfo, targetStat] = await Promise.all([lstat(canonicalPath), stat(canonicalPath)]);
  const parent = dirname(canonicalPath);
  const isRoot = parent === canonicalPath;
  const isMountRoot = isRoot || (await stat(parent)).dev !== targetStat.dev;
  return {
    canonicalPath,
    identity: identityFromStat(targetInfo),
    operandIdentity: identityFromStat(operandInfo),
    isMountRoot,
  };
}

async function resolveMissing(
  path: string,
  current = path,
  suffix: readonly string[] = [],
): Promise<string> {
  const existing = await existingPath(current);
  if (existing) return resolve(existing.canonicalPath, ...suffix);
  const parent = dirname(current);
  if (parent === current) throw new Error(`cannot resolve path root: ${path}`);
  return resolveMissing(path, parent, [relative(parent, current), ...suffix]);
}

function normalizedForCompare(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameOrAncestor(candidate: string, protectedPath: string): boolean {
  const from = normalizedForCompare(candidate);
  const to = normalizedForCompare(protectedPath);
  const child = relative(from, to);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

async function canonicalProtected(path: string): Promise<string> {
  return (await existingPath(path))?.canonicalPath ?? resolve(path);
}

function containsMountRoot(target: string, mountRoots: ReadonlySet<string>): boolean {
  return [...mountRoots].some(
    (mountRoot) =>
      normalizedForCompare(target) !== normalizedForCompare(mountRoot) &&
      sameOrAncestor(target, mountRoot),
  );
}

// eslint-disable-next-line complexity -- Critical roots and mount ancestry use one ordered deny list.
async function criticalReason(
  target: string,
  cwd: string,
  existing: ExistingPath | undefined,
  mountRoots: ReadonlySet<string> | undefined,
  recursive: boolean,
): Promise<string | undefined> {
  const root = parse(target).root;
  if (normalizedForCompare(target) === normalizedForCompare(root)) return "filesystem root";
  const [home, workingDirectory] = await Promise.all([
    canonicalProtected(homedir()),
    canonicalProtected(cwd),
  ]);
  if (sameOrAncestor(target, home)) return "home directory or its ancestor";
  if (sameOrAncestor(target, workingDirectory)) return "working directory or its ancestor";
  if (existing?.isMountRoot || mountRoots?.has(normalizedForCompare(target))) return "mount root";
  if (recursive && mountRoots && containsMountRoot(target, mountRoots)) {
    return "ancestor of a mount root";
  }
  return undefined;
}

// eslint-disable-next-line complexity -- Resolution keeps every fail-closed target check in order.
async function resolveWord(
  word: ResolvedWord,
  cwd: string,
  mountRoots: ReadonlySet<string> | undefined,
  recursive: boolean,
): Promise<TargetResolution> {
  if (word.value === undefined) {
    return { ok: false, action: "rewrite", reason: word.reason ?? "target is not exact" };
  }
  if (word.value.length === 0) {
    return { ok: false, action: "deny", reason: "empty destructive target" };
  }
  const candidate = isAbsolute(word.value) ? resolve(word.value) : resolve(cwd, word.value);
  const existing = await existingPath(candidate);
  const canonicalPath = existing?.canonicalPath ?? (await resolveMissing(candidate));
  const critical = await criticalReason(canonicalPath, cwd, existing, mountRoots, recursive);
  if (critical)
    return { ok: false, action: "deny", reason: `refusing destructive target: ${critical}` };
  return {
    ok: true,
    targets: [
      {
        canonicalPath,
        operandPath: candidate,
        existed: existing !== undefined,
        ...(existing
          ? { identity: existing.identity, operandIdentity: existing.operandIdentity }
          : {}),
        source: word.raw,
      },
    ],
  };
}

export async function resolveTargets(
  operations: readonly DestructiveOperation[],
  cwd: string,
): Promise<TargetResolution> {
  const targets: ResolvedTarget[] = [];
  const mountRoots = await mountedRoots();
  for (const operation of operations) {
    if (operation.targets.length === 0) {
      return { ok: false, action: "rewrite", reason: `${operation.command} has no exact target` };
    }
    for (const word of operation.targets) {
      const result = await resolveWord(
        word,
        cwd,
        mountRoots,
        operation.kind === "recursive-delete" || operation.kind === "git-clean",
      );
      if (!result.ok) return result;
      targets.push(...result.targets);
    }
  }
  const unique = new Map(
    targets.map((target) => [normalizedForCompare(target.canonicalPath), target]),
  );
  return { ok: true, targets: [...unique.values()] };
}

function syncIdentity(path: string): ObjectIdentity {
  const info = lstatSync(path, { bigint: true });
  return { device: String(info.dev), inode: String(info.ino) };
}

function sameIdentity(
  left: ObjectIdentity | undefined,
  right: ObjectIdentity | undefined,
): boolean {
  return left?.device === right?.device && left?.inode === right?.inode;
}

function verifyExisting(target: ResolvedTarget): boolean {
  try {
    const canonical = realpathSync.native(target.operandPath);
    return (
      normalizedForCompare(canonical) === normalizedForCompare(target.canonicalPath) &&
      sameIdentity(syncIdentity(target.canonicalPath), target.identity) &&
      sameIdentity(syncIdentity(target.operandPath), target.operandIdentity)
    );
  } catch {
    return false;
  }
}

function isMissing(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error: unknown) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}

function resolveMissingSync(path: string, current = path, suffix: readonly string[] = []): string {
  if (!isMissing(current)) return resolve(realpathSync.native(current), ...suffix);
  const parent = dirname(current);
  if (parent === current) throw new Error(`cannot resolve path root: ${path}`);
  return resolveMissingSync(path, parent, [basename(current), ...suffix]);
}

function verifyMissing(target: ResolvedTarget): boolean {
  try {
    const expected = resolveMissingSync(target.operandPath);
    return (
      normalizedForCompare(expected) === normalizedForCompare(target.canonicalPath) &&
      isMissing(target.operandPath) &&
      isMissing(target.canonicalPath)
    );
  } catch {
    return false;
  }
}

export function verifyTargets(targets: readonly ResolvedTarget[]): boolean {
  return targets.every((target) =>
    target.existed ? verifyExisting(target) : verifyMissing(target),
  );
}
