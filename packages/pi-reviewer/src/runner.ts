import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  createPiLaunchPlan,
  writePiRuntimeConfig,
  type PiAppDefinition,
} from "@osolmaz/pi-factory";

import { PiEventCollector } from "./pi-events.js";
import { parseReviewOutput } from "./review-output.js";
import { selectAppModel } from "./app.js";
import type { ModelSelection, ReviewOutput } from "./types.js";

const MAX_RUNTIME_MS = 10 * 60_000;
const MAX_INACTIVITY_MS = 2 * 60_000;
const TERMINATION_GRACE_MS = 2_000;
const MAX_STDERR_BYTES = 128 * 1024;

export type RunReviewInput = {
  readonly app: PiAppDefinition;
  readonly selection: ModelSelection;
  readonly cwd: string;
  readonly prompt: string;
  readonly stderr?: NodeJS.WritableStream;
};

export async function runReview(input: RunReviewInput): Promise<ReviewOutput> {
  const app = selectAppModel(input.app, input.selection);
  const runtime = await writePiRuntimeConfig(app);
  const plan = await createPiLaunchPlan(app, runtime, {
    cwd: input.cwd,
    mode: "json",
    noSession: true,
    provider: input.selection.provider,
    model: input.selection.model,
    thinking: input.selection.thinking,
    messages: [input.prompt],
  });
  const finalText = await executePlan(plan.command, plan.args, plan.cwd, plan.env, input.stderr);
  return parseReviewOutput(finalText);
}

async function executePlan(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  env: Readonly<Record<string, string>>,
  stderr: NodeJS.WritableStream | undefined,
): Promise<string> {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  return await collectChild(child, stderr);
}

async function collectChild(
  child: ChildProcessWithoutNullStreams,
  stderr: NodeJS.WritableStream | undefined,
): Promise<string> {
  const collector = new PiEventCollector();
  let stderrBytes = 0;
  let failure: Error | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let inactivityTimer: NodeJS.Timeout;
  const absoluteTimer = setTimeout(() => {
    terminate("review exceeded 10 minute limit");
  }, MAX_RUNTIME_MS);
  const resetInactivity = (): void => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      terminate("review produced no events for 2 minutes");
    }, MAX_INACTIVITY_MS);
  };
  const terminate = (message: string): void => {
    failure ??= new Error(message);
    terminateProcess(child);
    killTimer ??= setTimeout(() => {
      terminateProcess(child, true);
    }, TERMINATION_GRACE_MS);
  };
  const onInterrupt = (): void => {
    terminate("review cancelled");
  };
  const onTerminate = (): void => {
    terminate("review terminated");
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  resetInactivity();
  child.stdout.on("data", (chunk: Buffer) => {
    resetInactivity();
    try {
      collector.feed(chunk.toString("utf8"));
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      terminate(failure.message);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    resetInactivity();
    const remaining = MAX_STDERR_BYTES - stderrBytes;
    if (remaining <= 0) return;
    const output = chunk.subarray(0, remaining);
    stderrBytes += output.length;
    stderr?.write(output);
  });
  return await new Promise<string>((resolve, reject) => {
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(absoluteTimer);
      clearTimeout(inactivityTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      if (failure !== undefined) reject(failure);
      else if (signal !== null) reject(new Error(`Pi terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`Pi exited with status ${String(code)}`));
      else {
        try {
          resolve(collector.finish().finalText);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  });
}

function terminateProcess(child: ChildProcessWithoutNullStreams, force = false): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when the process group is already gone.
    }
  }
  child.kill(signal);
}
