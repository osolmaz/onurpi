import { fork, type ChildProcess } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LauncherOutboundMessage } from "./protocol.ts";

type MessageListener = (message: unknown) => void;

export type WorkerExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type PiWorker = {
  pid: number | undefined;
  send(message: LauncherOutboundMessage): void;
  onMessage(listener: MessageListener): void;
  wait(): Promise<WorkerExit>;
  kill(signal: NodeJS.Signals): void;
};

export type WorkerSpec = {
  entrypoint: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type StartWorker = (spec: WorkerSpec) => PiWorker;

function executableCandidate(command: string, directory: string): string {
  return isAbsolute(command) ? command : join(directory, command);
}

function resolvedExecutable(command: string, directory: string): string | undefined {
  const candidate = executableCandidate(command, directory);
  try {
    accessSync(candidate, constants.X_OK);
    const resolved = realpathSync(candidate);
    return statSync(resolved).isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_LAUNCHER_ENTRYPOINT = fileURLToPath(new URL("./bin/pi.ts", import.meta.url));

function resolvedPathPiEntrypoint(
  pathValue: string,
  launcherEntrypoint: string,
): string | undefined {
  const launcher = realpathSync(launcherEntrypoint);
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const resolved = resolvedExecutable("pi", directory);
    if (resolved && resolved !== launcher) return resolved;
  }
  return undefined;
}

export function resolvePiEntrypoint(
  pathValue = process.env["PATH"] ?? "",
  platform = process.platform,
  launcherEntrypoint = DEFAULT_LAUNCHER_ENTRYPOINT,
): string {
  if (platform !== "linux") {
    throw new Error("The restart-aware pi command currently supports tested Linux terminals only.");
  }
  const fromPath = resolvedPathPiEntrypoint(pathValue, launcherEntrypoint);
  if (fromPath) return fromPath;
  throw new Error(
    "Could not find the upstream pi command after the restart-aware launcher in PATH.",
  );
}

function childWorker(child: ChildProcess): PiWorker {
  let spawnError: Error | undefined;
  const exit = new Promise<WorkerExit>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal, ...(spawnError ? { error: spawnError } : {}) });
    });
  });
  return {
    pid: child.pid,
    send: (message) => {
      if (!child.connected) throw new Error("Pi worker IPC is disconnected.");
      child.send(message);
    },
    onMessage: (listener) => child.on("message", listener),
    wait: () => exit,
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

export function startPiWorker(spec: WorkerSpec): PiWorker {
  const child = fork(spec.entrypoint, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    detached: false,
  });
  return childWorker(child);
}
