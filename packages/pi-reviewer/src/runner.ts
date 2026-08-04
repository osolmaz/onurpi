import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { writePiRuntimeConfig, type PiAppDefinition } from "@osolmaz/pi-factory";

import { regularPiAuthPath } from "./auth-path.js";
import { PiEventCollector } from "./pi-events.js";
import { parseReviewOutput } from "./review-output.js";
import { selectAppModel } from "./app.js";
import type { ModelSelection, ReviewOutput } from "./types.js";
import type { ReviewWorkerRequest } from "./worker-protocol.js";

const MAX_RUNTIME_MS = 20 * 60_000;
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
  const extension = app.extensions?.[0];
  if (extension === undefined) throw new Error("Pi Reviewer extension is not configured");
  if (app.systemPrompt === undefined)
    throw new Error("Pi Reviewer system prompt is not configured");
  const request: ReviewWorkerRequest = {
    version: 1,
    cwd: input.cwd,
    prompt: input.prompt,
    authPath: regularPiAuthPath(),
    modelsPath: runtime.modelsPath,
    configDir: runtime.configDir,
    extensionPath: extension.path,
    systemPrompt: app.systemPrompt,
    provider: input.selection.provider,
    model: input.selection.model,
    thinking: input.selection.thinking,
    tools: app.tools?.split(",").filter((tool) => tool !== "") ?? [],
  };
  const finalText = await executeWorker(app.piCommand, request, app.env, input.stderr);
  return parseReviewOutput(finalText);
}

async function executeWorker(
  command: readonly string[],
  request: ReviewWorkerRequest,
  appEnv: Readonly<Record<string, string>> | undefined,
  stderr: NodeJS.WritableStream | undefined,
): Promise<string> {
  const [program, ...args] = command;
  if (program === undefined) throw new Error("Pi Reviewer worker command is empty");
  const child = spawn(program, args, {
    cwd: request.cwd,
    env: {
      ...process.env,
      ...appEnv,
      PI_OFFLINE: "1",
      PI_REVIEWER_WORKER: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
    },
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(request));
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
    terminate("review exceeded 20 minute limit");
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
      collector.feed(chunk);
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
