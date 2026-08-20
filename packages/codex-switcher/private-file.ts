import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PRIVATE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const NO_FOLLOW = constants.O_NOFOLLOW;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 5 * 60_000;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function assertPrivateRegularFile(path: string, mode: number, regular: boolean): void {
  if (!regular) throw new Error(`Protected file is not a regular file: ${path}`);
  if ((mode & 0o077) !== 0) {
    throw new Error(`Protected file permissions must be 0600: ${path}`);
  }
}

export function readPrivateFile(path: string, maxBytes: number): string {
  const before = lstatSync(path);
  assertPrivateRegularFile(path, before.mode, before.isFile());
  const descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  try {
    const after = fstatSync(descriptor);
    assertPrivateRegularFile(path, after.mode, after.isFile());
    if (after.size > maxBytes) {
      throw new Error(`Protected file exceeds its ${String(maxBytes)} byte limit: ${path}`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function writePrivateFile(path: string, contents: string, maxBytes: number): void {
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new Error(`Protected file exceeds its ${String(maxBytes)} byte limit: ${path}`);
  }
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  try {
    const current = lstatSync(path);
    if (!current.isFile()) throw new Error(`Protected path is not a regular file: ${path}`);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const temporary = join(
    directory,
    `.${basename(path)}.${String(process.pid)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
      PRIVATE_MODE,
    );
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    chmodSync(path, PRIVATE_MODE);
    const directoryDescriptor = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Operation aborted.");
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function removeStaleLock(path: string): void {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) throw new Error(`Protected lock is not a regular file: ${path}`);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) rmSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function acquireLock(path: string, signal: AbortSignal): Promise<number> {
  const started = Date.now();
  for (;;) {
    try {
      const descriptor = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
        PRIVATE_MODE,
      );
      writeFileSync(descriptor, `${String(process.pid)}\n`, "utf8");
      fsyncSync(descriptor);
      return descriptor;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      removeStaleLock(path);
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error("Timed out while waiting for the protected file lock.");
      }
      await delay(LOCK_RETRY_MS, signal);
    }
  }
}

export async function withPrivateFileLock<T>(
  path: string,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  const lockPath = `${path}.lock`;
  const descriptor = await acquireLock(lockPath, signal);
  try {
    return await operation();
  } finally {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}

export function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
