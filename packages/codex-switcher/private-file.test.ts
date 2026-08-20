import { chmodSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readPrivateFile, withPrivateFileLock, writePrivateFile } from "./private-file.ts";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "private-file-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("private files", () => {
  it("writes, replaces, and reads bounded private data", () => {
    const path = join(temporaryDirectory(), "state.json");
    writePrivateFile(path, "one", 10);
    writePrivateFile(path, "two", 10);
    expect(readPrivateFile(path, 10)).toBe("two");
  });

  it("writes safely without directory fsync on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const path = join(temporaryDirectory(), "state.json");
    writePrivateFile(path, "value", 10);
    expect(readPrivateFile(path, 10)).toBe("value");
  });

  it("rejects oversized writes and reads", () => {
    const path = join(temporaryDirectory(), "state.json");
    expect(() => {
      writePrivateFile(path, "too long", 2);
    }).toThrow("byte limit");
    writeFileSync(path, "too long", { mode: 0o600 });
    expect(() => readPrivateFile(path, 2)).toThrow("byte limit");
  });

  it("rejects permissive and non-regular targets", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "state.json");
    writeFileSync(path, "value", { mode: 0o600 });
    chmodSync(path, 0o644);
    expect(() => readPrivateFile(path, 10)).toThrow("permissions must be 0600");

    const link = join(directory, "link.json");
    symlinkSync(path, link);
    expect(() => {
      writePrivateFile(link, "value", 10);
    }).toThrow("not a regular file");
  });
});

describe("private file locks", () => {
  it("serializes concurrent operations", async () => {
    const path = join(temporaryDirectory(), "state.json");
    const order: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPrivateFileLock(path, new AbortController().signal, async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    const second = withPrivateFileLock(path, new AbortController().signal, () => {
      order.push("second");
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("removes a stale lock before continuing", async () => {
    const path = join(temporaryDirectory(), "state.json");
    const lock = `${path}.lock`;
    writeFileSync(lock, "old", { mode: 0o600 });
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, old, old);
    await expect(
      withPrivateFileLock(path, new AbortController().signal, () => Promise.resolve("done")),
    ).resolves.toBe("done");
  });

  it("honors cancellation while waiting for a lock", async () => {
    const path = join(temporaryDirectory(), "state.json");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPrivateFileLock(path, new AbortController().signal, () => gate);
    const controller = new AbortController();
    const second = withPrivateFileLock(path, controller.signal, () => Promise.resolve());
    controller.abort(new Error("cancelled"));
    await expect(second).rejects.toThrow("cancelled");
    release?.();
    await first;
  });
});
