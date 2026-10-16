#!/usr/bin/env -S node --import jiti/register
// jiti is the loader Pi uses for extensions. It maps the `.js` imports in codex-switcher's
// dependencies to their `.ts` files, which plain Node does not do.
import { parseArgs } from "node:util";
import { loadWorkerConfig } from "./config.ts";
import { parseMountSource, sandboxDriverConfig, type SandboxRuntime } from "./mounts.ts";
import { startWorker } from "./worker.ts";

const USAGE = `usage:
  agent-worker run --config <config.json>
  agent-worker mounts --runtime docker|podman --workspace host:/path|volume:name --config host:/path|volume:name`;

async function run(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { config: { type: "string" } } });
  if (values.config === undefined) throw new Error(USAGE);
  const worker = await startWorker(loadWorkerConfig(values.config));
  const stop = () => {
    void worker.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function mounts(args: readonly string[]): void {
  const { values } = parseArgs({
    args: [...args],
    options: {
      config: { type: "string" },
      runtime: { type: "string" },
      workspace: { type: "string" },
    },
  });
  const runtime = values.runtime;
  if (
    (runtime !== "docker" && runtime !== "podman") ||
    values.workspace === undefined ||
    values.config === undefined
  ) {
    throw new Error(USAGE);
  }
  const driver = sandboxDriverConfig(
    runtime satisfies SandboxRuntime,
    parseMountSource(values.workspace),
    parseMountSource(values.config),
  );
  console.log(JSON.stringify(driver));
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "run") await run(rest);
  else if (command === "mounts") mounts(rest);
  else throw new Error(USAGE);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
