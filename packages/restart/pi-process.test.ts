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
  it("skips the restart-aware pi command and resolves the next Pi in PATH", () => {
    const wrapperRoot = temporaryRoot();
    const upstreamRoot = temporaryRoot();
    const wrapperEntrypoint = join(wrapperRoot, "pi.ts");
    const upstreamEntrypoint = join(upstreamRoot, "cli.js");
    writeFileSync(wrapperEntrypoint, "#!/usr/bin/env node\n");
    writeFileSync(upstreamEntrypoint, "#!/usr/bin/env node\n");
    chmodSync(wrapperEntrypoint, 0o755);
    chmodSync(upstreamEntrypoint, 0o755);
    symlinkSync(wrapperEntrypoint, join(wrapperRoot, "pi"));
    symlinkSync(upstreamEntrypoint, join(upstreamRoot, "pi"));

    const pathValue = `${wrapperRoot}${delimiter}${upstreamRoot}`;
    expect(resolvePiEntrypoint(pathValue, "linux", wrapperEntrypoint)).toBe(upstreamEntrypoint);

    const updatedEntrypoint = join(upstreamRoot, "cli-updated.js");
    writeFileSync(updatedEntrypoint, "#!/usr/bin/env node\n");
    chmodSync(updatedEntrypoint, 0o755);
    rmSync(join(upstreamRoot, "pi"));
    symlinkSync(updatedEntrypoint, join(upstreamRoot, "pi"));
    expect(resolvePiEntrypoint(pathValue, "linux", wrapperEntrypoint)).toBe(updatedEntrypoint);
  });

  it("uses the co-installed Pi when every PATH command resolves to the wrapper", () => {
    const wrapperRoot = temporaryRoot();
    const upstreamRoot = temporaryRoot();
    const wrapperEntrypoint = join(wrapperRoot, "pi.ts");
    const upstreamEntrypoint = join(upstreamRoot, "cli.js");
    writeFileSync(wrapperEntrypoint, "#!/usr/bin/env node\n");
    writeFileSync(upstreamEntrypoint, "#!/usr/bin/env node\n");
    chmodSync(wrapperEntrypoint, 0o755);
    chmodSync(upstreamEntrypoint, 0o755);
    symlinkSync(wrapperEntrypoint, join(wrapperRoot, "pi"));

    expect(resolvePiEntrypoint(wrapperRoot, "linux", wrapperEntrypoint, upstreamEntrypoint)).toBe(
      upstreamEntrypoint,
    );
  });

  it("rejects missing upstream commands and unsupported platforms", () => {
    const wrapperRoot = temporaryRoot();
    const wrapperEntrypoint = join(wrapperRoot, "pi.ts");
    const missingUpstream = join(wrapperRoot, "missing-cli.js");
    writeFileSync(wrapperEntrypoint, "#!/usr/bin/env node\n");
    chmodSync(wrapperEntrypoint, 0o755);
    symlinkSync(wrapperEntrypoint, join(wrapperRoot, "pi"));

    expect(() =>
      resolvePiEntrypoint(wrapperRoot, "linux", wrapperEntrypoint, missingUpstream),
    ).toThrow(/upstream pi command/u);
    expect(() => resolvePiEntrypoint("", "darwin", wrapperEntrypoint)).toThrow(/tested Linux/u);
    expect(() => resolvePiEntrypoint("", "win32", wrapperEntrypoint)).toThrow(/tested Linux/u);
  });

  it.each(["direct", "shell-shim"])("starts a %s Pi command with working IPC", async (kind) => {
    const root = temporaryRoot();
    const workerScript = join(root, "worker.mjs");
    writeFileSync(
      workerScript,
      [
        "#!/usr/bin/env node",
        "process.send?.({ kind: 'ready' });",
        "process.on('message', () => process.exit(0));",
      ].join("\n"),
    );
    chmodSync(workerScript, 0o755);

    const entrypoint = kind === "direct" ? workerScript : join(root, "pi");
    if (kind === "shell-shim") {
      writeFileSync(
        entrypoint,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(workerScript)} "$@"\n`,
      );
      chmodSync(entrypoint, 0o755);
    }

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
