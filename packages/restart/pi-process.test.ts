import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePiEntrypoint, startPiWorker } from "./pi-process.ts";
import { RESTART_PROTOCOL_SCHEMA } from "./protocol.ts";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "onurpi-restart-process-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Pi process adapter", () => {
  it("prefers the co-installed Pi CLI over PATH", () => {
    const packageRoot = temporaryRoot();
    const pathRoot = temporaryRoot();
    const packageEntrypoint = join(packageRoot, "index.js");
    const cliEntrypoint = join(packageRoot, "cli.js");
    const pathEntrypoint = join(pathRoot, "global-pi.js");
    writeFileSync(packageEntrypoint, "");
    writeFileSync(cliEntrypoint, "#!/usr/bin/env node\n");
    writeFileSync(pathEntrypoint, "#!/usr/bin/env node\n");
    chmodSync(cliEntrypoint, 0o755);
    chmodSync(pathEntrypoint, 0o755);
    symlinkSync(pathEntrypoint, join(pathRoot, "pi"));

    expect(resolvePiEntrypoint(pathRoot, "linux", () => packageEntrypoint)).toBe(cliEntrypoint);
  });

  it("falls back to the first executable Pi symlink in PATH without a shell", () => {
    const first = temporaryRoot();
    const second = temporaryRoot();
    const entrypoint = join(second, "cli.js");
    writeFileSync(entrypoint, "#!/usr/bin/env node\n");
    chmodSync(entrypoint, 0o755);
    symlinkSync(entrypoint, join(second, "pi"));
    expect(
      resolvePiEntrypoint(`${first}${delimiter}${second}`, "linux", () => {
        throw new Error("Package unavailable");
      }),
    ).toBe(entrypoint);
  });

  it("rejects missing executables and unsupported platforms", () => {
    const missingPackage = (): string => {
      throw new Error("Package unavailable");
    };
    expect(() => resolvePiEntrypoint(temporaryRoot(), "linux", missingPackage)).toThrow(
      /Could not find/u,
    );
    expect(() => resolvePiEntrypoint("", "darwin", missingPackage)).toThrow(/tested Linux/u);
    expect(() => resolvePiEntrypoint("", "win32", missingPackage)).toThrow(/tested Linux/u);
  });

  it("forks a Node entrypoint with working IPC", async () => {
    const root = temporaryRoot();
    const entrypoint = join(root, "worker.mjs");
    writeFileSync(
      entrypoint,
      ["process.send?.({ kind: 'ready' });", "process.on('message', () => process.exit(0));"].join(
        "\n",
      ),
    );
    const worker = startPiWorker({ entrypoint, args: [], cwd: root, env: process.env });
    const message = new Promise<unknown>((resolve) => {
      worker.onMessage(resolve);
    });
    await expect(message).resolves.toEqual({ kind: "ready" });
    worker.send({
      schema: RESTART_PROTOCOL_SCHEMA,
      type: "restartAccepted",
      requestId: "request-1",
      generation: "generation-1",
    });
    await expect(worker.wait()).resolves.toMatchObject({ code: 0, signal: null });
  });
});
