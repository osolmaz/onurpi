#!/usr/bin/env -S node --import jiti/register
// jiti is the loader Pi uses for extensions. It runs TypeScript syntax in the workspace packages,
// such as constructor parameter properties, that Node's type stripping does not.
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { loadWorkerConfig } from "./config.ts";
import { deliver } from "./inbox.ts";
import { parseMountSource, sandboxDriverConfig, type SandboxRuntime } from "./mounts.ts";
import { startWorker } from "./worker.ts";

const USAGE = `usage:
  agent-worker run --config <config.json>
  agent-worker mounts --runtime docker|podman --workspace host:/path|volume:name --config host:/path|volume:name [--instructions host:/path/AGENTS.md] [--hide secrets/ --hide file.env]
  agent-worker deliver --inbox <folder> --channel <discord channel id> --prompt <text>|--prompt-file <file> [--job <id>] [--scheduled-for <time>]`;

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
      hide: { multiple: true, type: "string" },
      instructions: { type: "string" },
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
  const driver = sandboxDriverConfig(runtime satisfies SandboxRuntime, {
    config: parseMountSource(values.config),
    hide: values.hide ?? [],
    workspace: parseMountSource(values.workspace),
    ...(values.instructions === undefined
      ? {}
      : { instructions: parseMountSource(values.instructions) }),
  });
  console.log(JSON.stringify(driver));
}

function required(value: string | undefined): string {
  if (value === undefined) throw new Error(USAGE);
  return value;
}

/**
 * Puts one scheduled prompt into the agent's inbox. Under onurcron, the job id and the scheduled
 * time come from ONURCRON_JOB_ID and ONURCRON_SCHEDULED_FOR, so a retried dispatch writes nothing.
 */
async function deliverPrompt(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      channel: { type: "string" },
      inbox: { type: "string" },
      job: { type: "string" },
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      "scheduled-for": { type: "string" },
    },
  });
  const job = required(values.job ?? process.env["ONURCRON_JOB_ID"]);
  const promptFile = values["prompt-file"];
  const prompt =
    promptFile === undefined ? required(values.prompt) : await readFile(promptFile, "utf8");
  const scheduledFor =
    values["scheduled-for"] ?? process.env["ONURCRON_SCHEDULED_FOR"] ?? new Date().toISOString();
  const written = await deliver(required(values.inbox), {
    channelId: required(values.channel),
    job,
    prompt,
    scheduledFor,
  });
  console.log(
    written
      ? `delivered ${job} for ${scheduledFor}`
      : `already delivered ${job} for ${scheduledFor}`,
  );
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "run") await run(rest);
  else if (command === "mounts") mounts(rest);
  else if (command === "deliver") await deliverPrompt(rest);
  else throw new Error(USAGE);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
