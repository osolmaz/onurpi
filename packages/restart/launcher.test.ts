import { describe, expect, it, vi } from "vitest";

import { runLauncher, type LauncherDependencies } from "./launcher.ts";
import type { PiWorker, WorkerExit, WorkerSpec } from "./pi-process.ts";
import {
  RESTART_GENERATION_ENV,
  RESTART_PROTOCOL_SCHEMA,
  type LauncherOutboundMessage,
  type RestartRequest,
} from "./protocol.ts";

type Identity = Pick<RestartRequest, "sessionFile" | "sessionId" | "cwd">;
type WorkerPlan = {
  request?: Identity;
  ready?: Identity;
  exitCode?: number;
  duplicate?: boolean;
};

class FakeWorker implements PiWorker {
  readonly pid = 100;
  readonly sent: LauncherOutboundMessage[] = [];
  private messageListener: ((message: unknown) => void) | undefined;
  private resolveExit: ((exit: WorkerExit) => void) | undefined;
  private readonly exitPromise = new Promise<WorkerExit>((resolve) => {
    this.resolveExit = resolve;
  });

  constructor(
    private readonly spec: WorkerSpec,
    private readonly plan: WorkerPlan,
  ) {}

  send(message: LauncherOutboundMessage): void {
    this.sent.push(message);
    if (message.type === "restartAccepted") {
      this.finish(this.plan.exitCode ?? 0);
    } else if (!this.plan.duplicate) {
      this.finish(0);
    }
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
    queueMicrotask(() => {
      this.emitPlan();
    });
  }

  wait(): Promise<WorkerExit> {
    return this.exitPromise;
  }

  kill(signal: NodeJS.Signals): void {
    this.resolveExit?.({ code: null, signal });
  }

  private finish(code: number): void {
    this.resolveExit?.({ code, signal: null });
  }

  private emitPlan(): void {
    const generation = this.spec.env[RESTART_GENERATION_ENV] ?? "missing";
    if (this.plan.request) {
      this.emitRequest(generation, this.plan.request);
      return;
    }
    if (this.plan.ready) this.emitReady(generation, this.plan.ready);
    this.finish(this.plan.exitCode ?? 0);
  }

  private emitRequest(generation: string, identity: Identity): void {
    const request: RestartRequest = {
      schema: RESTART_PROTOCOL_SCHEMA,
      type: "restartRequest",
      requestId: "request-1",
      generation,
      ...identity,
    };
    this.messageListener?.(request);
    if (this.plan.duplicate) this.messageListener?.({ ...request, requestId: "request-2" });
  }

  private emitReady(generation: string, identity: Identity): void {
    this.messageListener?.({
      schema: RESTART_PROTOCOL_SCHEMA,
      type: "runtimeReady",
      generation,
      ...identity,
    });
  }
}

const identity: Identity = {
  sessionFile: "/sessions/one.jsonl",
  sessionId: "session-1",
  cwd: "/repo",
};

function harness(plans: WorkerPlan[], launchCwd = identity.cwd) {
  const specs: WorkerSpec[] = [];
  const workers: FakeWorker[] = [];
  const errors: string[] = [];
  let generation = 0;
  const startWorker = (spec: WorkerSpec): PiWorker => {
    const plan = plans[specs.length];
    if (!plan) throw new Error("unexpected worker");
    specs.push(spec);
    const worker = new FakeWorker(spec, plan);
    workers.push(worker);
    return worker;
  };
  const deps: Partial<LauncherDependencies> = {
    startWorker,
    resolveEntrypoint: () => "/bin/pi-cli.js",
    createGeneration: () => `generation-${String(++generation)}`,
    readHeader: () => ({ id: identity.sessionId, cwd: identity.cwd }),
    stat: (path) => ({
      isFile: () => path !== identity.cwd,
      isDirectory: () => path === identity.cwd,
    }),
    writeError: (message) => errors.push(message),
    onWorker: vi.fn(),
    shouldStop: () => false,
    env: {},
    cwd: launchCwd,
  };
  return { deps, specs, workers, errors };
}

describe("restart launcher", () => {
  it("starts a replacement in the session cwd after the accepted worker exits", async () => {
    const test = harness([{ request: identity }, { ready: identity }], "/invocation");
    await expect(runLauncher([], test.deps)).resolves.toBe(0);
    expect(test.specs).toHaveLength(2);
    expect(test.specs[0]?.cwd).toBe("/invocation");
    expect(test.workers[0]?.sent).toContainEqual(
      expect.objectContaining({ type: "restartAccepted", requestId: "request-1" }),
    );
    expect(test.specs[1]?.args).toEqual(["--session", identity.sessionFile]);
    expect(test.specs[1]?.cwd).toBe(identity.cwd);
    expect(test.specs[1]?.env).toMatchObject({
      ONURPI_RESTART_EXPECTED_SESSION_FILE: identity.sessionFile,
      ONURPI_RESTART_EXPECTED_SESSION_ID: identity.sessionId,
      ONURPI_RESTART_EXPECTED_CWD: identity.cwd,
    });
  });

  it("does not restart after an ordinary exit", async () => {
    const test = harness([{}]);
    await expect(runLauncher([], test.deps)).resolves.toBe(0);
    expect(test.specs).toHaveLength(1);
  });

  it("rejects invalid identity and keeps one worker", async () => {
    const test = harness([{ request: { ...identity, sessionId: "wrong" } }]);
    await expect(runLauncher([], test.deps)).resolves.toBe(0);
    expect(test.workers[0]?.sent[0]).toMatchObject({
      type: "restartRejected",
      reason: "Session ID does not match the session file.",
    });
    expect(test.specs).toHaveLength(1);
  });

  it("rejects unsupported startup arguments", async () => {
    const test = harness([{ request: identity }]);
    await expect(runLauncher(["--no-session"], test.deps)).resolves.toBe(0);
    expect(test.workers[0]?.sent[0]).toMatchObject({ type: "restartRejected" });
    expect(test.specs).toHaveLength(1);
  });

  it("rejects a duplicate pending request", async () => {
    const test = harness([{ request: identity, duplicate: true }, {}]);
    await expect(runLauncher([], test.deps)).resolves.toBe(0);
    expect(test.workers[0]?.sent).toContainEqual(
      expect.objectContaining({ type: "restartRejected", requestId: "request-2" }),
    );
  });

  it("prints recovery and does not restart after failed shutdown", async () => {
    const test = harness([{ request: identity, exitCode: 2 }]);
    await expect(runLauncher([], test.deps)).resolves.toBe(2);
    expect(test.specs).toHaveLength(1);
    expect(test.errors.join("\n")).toContain(identity.sessionFile);
    expect(test.errors.join("\n")).toContain("exited with code 2");
  });

  it("prints recovery when replacement spawn fails", async () => {
    const test = harness([{ request: identity }]);
    await expect(runLauncher([], test.deps)).resolves.toBe(1);
    expect(test.errors.join("\n")).toContain("unexpected worker");
    expect(test.errors.join("\n")).toContain(identity.sessionFile);
  });
});
