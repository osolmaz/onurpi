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
  it("resolves the first executable Pi symlink without a shell", () => {
    const first = temporaryRoot();
    const second = temporaryRoot();
    const entrypoint = join(second, "cli.js");
    writeFileSync(entrypoint, "#!/usr/bin/env node\n");
    chmodSync(entrypoint, 0o755);
    symlinkSync(entrypoint, join(second, "pi"));
    expect(resolvePiEntrypoint(`${first}${delimiter}${second}`, "linux")).toBe(entrypoint);
  });

  it("rejects missing executables and unsupported platforms", () => {
    expect(() => resolvePiEntrypoint(temporaryRoot(), "linux")).toThrow(/Could not find/u);
    expect(() => resolvePiEntrypoint("", "darwin")).toThrow(/tested Linux/u);
    expect(() => resolvePiEntrypoint("", "win32")).toThrow(/tested Linux/u);
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
