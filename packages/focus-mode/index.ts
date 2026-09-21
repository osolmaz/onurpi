/**
 * Pi wiring for focus mode.
 *
 * The gate runs on `input`, before a turn begins, and every session re-checks its lease at
 * `before_agent_start`, `turn_start`, and `tool_call`. A refusal restores the prompt text into the
 * editor and returns `handled`, so the model never sees it and the session transcript gains no
 * entry. Over-cap convergence asks one holder to abandon its own run: the victim calls `ctx.abort()`
 * inside its own session, and no signal is ever sent to another process.
 *
 * All policy lives in the sibling modules; this file connects hooks.
 */

import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type InputEventResult,
} from "@earendil-works/pi-coding-agent";

import { loadConfig, resolveConfigPath, writeMaxAgents, type FocusModeConfig } from "./config.ts";
import { decideConvergence } from "./converge.ts";
import { preserveRejectedPrompt } from "./editor.ts";
import { decideGate, type InputSource } from "./gate.ts";
import {
  capChanged,
  configErrorNotice,
  failureNotice,
  listEmpty,
  listHeader,
  rejectNotice,
  statusText,
  stopNotice,
  type FocusState,
} from "./notice.ts";
import {
  claim,
  describeLease,
  isProcessAlive,
  isStopRequested,
  leaseDir,
  listLeases,
  readOwnLease,
  refresh,
  release,
  requestStop,
  sessionSlug,
  sweep,
  type Lease,
} from "./store.ts";

const STATUS_KEY = "focus-mode";
const FLAG_NAME = "focus-max";

/**
 * How long a claim waits for a turn to start. Pi can refuse a prompt after the `input` event but
 * before any run starts, for example when no model is selected or credentials fail, and then no
 * settle event ever arrives. The claim is released when no turn follows inside this window.
 */
const CLAIM_CONFIRM_MS = 5000;

/** Keys the flag exposes as `focus-max`, so one session can run with another cap. */
const FLAG_DESCRIPTION = "Per-session focus mode cap, for example --focus-max 1";

type SessionState = {
  dir: string;
  configPath: string;
  sessionId: string;
  sessionFile: string;
  cwd: string;
  capOverride: number | undefined;
  holds: boolean;
  notifiedError: boolean;
  ctx: ExtensionContext | undefined;
  heartbeat: NodeJS.Timeout | undefined;
  stopPoll: NodeJS.Timeout | undefined;
  awaitingStart: NodeJS.Timeout | undefined;
};

type Prepared = {
  state: SessionState;
  config: FocusModeConfig;
  live: Lease[];
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseCap(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

class FocusModeSession {
  private state: SessionState | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  register(): void {
    this.pi.on("session_start", (_event, ctx) => {
      this.start(ctx);
    });
    this.pi.on("input", (event, ctx) =>
      this.onInput(ctx, event.text, event.source, event.images ?? []),
    );
    this.pi.on("before_agent_start", (_event, ctx) => {
      this.revalidate(ctx);
    });
    this.pi.on("turn_start", (_event, ctx) => {
      this.revalidate(ctx);
    });
    this.pi.on("tool_call", (_event, ctx) => {
      this.revalidate(ctx);
    });
    this.pi.on("agent_start", () => {
      this.confirmLease();
    });
    this.pi.on("agent_settled", (_event, ctx) => {
      this.settle(ctx);
    });
    this.pi.on("session_shutdown", (_event, ctx) => {
      this.shutdown(ctx);
    });
    this.pi.registerCommand("focus", {
      description: "Show or change the focus mode cap",
      handler: (args, ctx) => this.command(args, ctx),
    });
    this.pi.registerFlag(FLAG_NAME, { description: FLAG_DESCRIPTION, type: "string" });
  }

  private start(ctx: ExtensionContext): void {
    try {
      const configPath = resolveConfigPath(getAgentDir());
      const sessionFile = ctx.sessionManager.getSessionFile() ?? "";
      const sessionId = sessionSlug(sessionFile === "" ? undefined : sessionFile, process.pid);
      const dir = leaseDir(configPath);
      const stored = this.pi.getFlag(FLAG_NAME);
      this.state = {
        dir,
        configPath,
        sessionId,
        sessionFile,
        cwd: ctx.cwd,
        capOverride: typeof stored === "string" ? parseCap(stored) : undefined,
        holds: false,
        notifiedError: false,
        ctx,
        heartbeat: undefined,
        stopPoll: undefined,
        awaitingStart: undefined,
      };
      // A reload of the same session can leave its own lease behind. The agent is not working yet.
      try {
        release(dir, sessionId);
      } catch {
        // A lease path that cannot be used must not stop the session.
      }
      this.startTimers();
      const prepared = this.prepare();
      if (prepared !== undefined) this.publishStatus(ctx, prepared);
    } catch (error) {
      this.fail(ctx, error);
    }
  }

  private onInput(
    ctx: ExtensionContext,
    text: string,
    source: InputSource,
    images: readonly unknown[],
  ): InputEventResult | undefined {
    try {
      const prepared = this.prepare();
      if (prepared === undefined) return undefined;
      const { state, config, live } = prepared;
      const decision = decideGate({
        enabled: config.enabled,
        holdsLease: state.holds,
        live,
        maxAgents: this.cap(config),
        source,
      });
      if (decision.action === "continue") {
        if (decision.claim) this.tryClaim(true);
        const refreshed = decision.claim ? this.prepare() : prepared;
        if (refreshed !== undefined) this.publishStatus(ctx, refreshed);
        return { action: "continue" };
      }
      const preserved = preserveRejectedPrompt(ctx.ui, text, images);
      if (config.notify) {
        ctx.ui.notify(
          rejectNotice(decision.count, decision.max, preserved.images, preserved.restored),
          "warning",
        );
      }
      ctx.ui.setStatus(STATUS_KEY, statusText(decision.count, decision.max, "full"));
      return { action: "handled" };
    } catch (error) {
      this.fail(ctx, error);
      return { action: "continue" };
    }
  }

  private revalidate(ctx: ExtensionContext): void {
    try {
      let prepared = this.prepare();
      if (!prepared?.config.enabled) return;
      // A turn is starting, so the claim that `input` made is real.
      this.confirmLease();
      if (isStopRequested(readOwnLease(prepared.state.dir, prepared.state.sessionId))) {
        this.stopSelf(ctx, prepared);
        return;
      }
      // A session that started a turn without a lease takes one now, when the cap has room.
      if (!prepared.state.holds) {
        if (!this.tryClaim()) return;
        prepared = this.prepare() ?? prepared;
      }
      this.converge(ctx, prepared);
    } catch (error) {
      this.fail(ctx, error);
    }
  }

  /** Abandon this session's own run. The abort stays inside this process. */
  private stopSelf(ctx: ExtensionContext, prepared: Prepared): void {
    const max = this.cap(prepared.config);
    if (prepared.config.notify) ctx.ui.notify(stopNotice(prepared.live.length, max), "warning");
    prepared.state.holds = false;
    this.clearStatus(ctx);
    ctx.abort();
  }

  private converge(ctx: ExtensionContext, prepared: Prepared): void {
    const { state, config, live } = prepared;
    const max = this.cap(config);
    const decision = decideConvergence({
      live,
      sessionId: state.sessionId,
      maxAgents: max,
      policy: config.victimPolicy,
    });
    if (decision.action === "keep") {
      this.publishStatus(ctx, prepared);
      return;
    }
    if (decision.action === "request-stop") {
      requestStop(state.dir, decision.victim.sessionId, nowIso());
      return;
    }
    this.stopSelf(ctx, prepared);
  }

  private settle(ctx: ExtensionContext): void {
    try {
      const state = this.state;
      if (state === undefined) return;
      this.cancelClaimConfirmation(state);
      release(state.dir, state.sessionId);
      state.holds = false;
      this.clearStatus(ctx);
    } catch (error) {
      this.fail(ctx, error);
    }
  }

  private shutdown(ctx: ExtensionContext): void {
    const state = this.state;
    this.state = undefined;
    if (state === undefined) return;
    if (state.heartbeat !== undefined) clearInterval(state.heartbeat);
    if (state.stopPoll !== undefined) clearInterval(state.stopPoll);
    this.cancelClaimConfirmation(state);
    release(state.dir, state.sessionId);
    this.clearStatus(ctx);
  }

  private command(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const trimmed = args.trim();
    if (trimmed.startsWith("max")) {
      this.commandMax(trimmed.slice(3).trim(), ctx);
    } else if (trimmed === "list") {
      this.commandList(ctx);
    } else {
      this.commandStatus(ctx);
    }
    return Promise.resolve();
  }

  private commandMax(value: string, ctx: ExtensionCommandContext): void {
    const parsed = parseCap(value);
    const state = this.state;
    if (parsed === undefined || state === undefined) {
      ctx.ui.notify("Focus mode: use /focus max <number>", "warning");
      return;
    }
    const loaded = writeMaxAgents(state.configPath, parsed);
    // Use the clamped value, so `/focus max 99` cannot lift this session above the limit.
    state.capOverride = loaded.config.maxAgents;
    if (loaded.errors.length > 0) ctx.ui.notify(configErrorNotice(loaded.errors), "warning");
    ctx.ui.notify(capChanged(loaded.config.maxAgents), "info");
  }

  private commandList(ctx: ExtensionCommandContext): void {
    const prepared = this.prepare();
    if (prepared === undefined) return;
    const { config, live } = prepared;
    if (live.length === 0) {
      ctx.ui.notify(listEmpty(), "info");
      return;
    }
    const now = nowIso();
    const lines = live.map((lease) => describeLease(lease, now));
    ctx.ui.notify([listHeader(live.length, this.cap(config)), ...lines].join("\n"), "info");
  }

  private commandStatus(ctx: ExtensionCommandContext): void {
    const prepared = this.prepare();
    if (prepared === undefined) return;
    const { state, config, live } = prepared;
    const max = this.cap(config);
    const label: FocusState = state.holds ? "held" : live.length < max ? "ready" : "full";
    const capNote = config.enabled ? "" : " (disabled by config)";
    ctx.ui.notify(`${statusText(live.length, max, label)}${capNote}`, "info");
  }

  private prepare(): Prepared | undefined {
    const state = this.state;
    if (state === undefined) return undefined;
    const config = this.config();
    sweep(state.dir, nowIso(), config.staleMs, (pid) => isProcessAlive(pid));
    const { leases } = listLeases(state.dir);
    return { state, config, live: leases.map((entry) => entry.lease) };
  }

  /** Reload the config on every check, so an edited file or `/focus max` takes effect. */
  private config(): FocusModeConfig {
    const state = this.state;
    if (state === undefined) return loadConfig("").config;
    const loaded = loadConfig(state.configPath);
    if (loaded.errors.length > 0 && !state.notifiedError) {
      state.notifiedError = true;
      if (state.ctx !== undefined) {
        state.ctx.ui.notify(configErrorNotice(loaded.errors), "warning");
      }
    }
    return loaded.config;
  }

  private cap(config: FocusModeConfig): number {
    return this.state?.capOverride ?? config.maxAgents;
  }

  private tryClaim(confirm = false): boolean {
    const state = this.state;
    if (state === undefined) return false;
    const result = claim(state.dir, {
      sessionId: state.sessionId,
      pid: process.pid,
      sessionFile: state.sessionFile,
      cwd: state.cwd,
      now: nowIso(),
    });
    if (result.status === "taken") return false;
    state.holds = true;
    if (confirm) this.armClaimConfirmation(state);
    return true;
  }

  /** A claim from `input` must be followed by a turn, or the slot goes back. */
  private armClaimConfirmation(state: SessionState): void {
    this.cancelClaimConfirmation(state);
    state.awaitingStart = setTimeout(() => {
      this.releaseUnconfirmedClaim();
    }, CLAIM_CONFIRM_MS);
    state.awaitingStart.unref();
  }

  private cancelClaimConfirmation(state: SessionState): void {
    if (state.awaitingStart === undefined) return;
    clearTimeout(state.awaitingStart);
    state.awaitingStart = undefined;
  }

  /** Called when a turn is known to be starting. */
  private confirmLease(): void {
    const state = this.state;
    if (state === undefined) return;
    this.cancelClaimConfirmation(state);
  }

  private releaseUnconfirmedClaim(): void {
    const state = this.state;
    if (state === undefined || !state.holds || state.awaitingStart === undefined) return;
    state.awaitingStart = undefined;
    release(state.dir, state.sessionId);
    state.holds = false;
    if (state.ctx !== undefined) this.clearStatus(state.ctx);
  }

  private startTimers(): void {
    const state = this.state;
    if (state === undefined) return;
    const config = this.config();
    state.heartbeat = setInterval(() => {
      this.heartbeat();
    }, config.heartbeatMs);
    state.stopPoll = setInterval(() => {
      this.checkStopRequest();
    }, config.stopPollMs);
    state.heartbeat.unref();
    state.stopPoll.unref();
  }

  private heartbeat(): void {
    const state = this.state;
    if (!state?.holds) return;
    try {
      const served = refresh(state.dir, state.sessionId, nowIso());
      if (served) return;
      state.holds = false;
      if (this.config().notify && state.ctx !== undefined) {
        state.ctx.ui.notify("Focus mode lost its lease and will take a new one.", "warning");
      }
    } catch {
      // A heartbeat failure must never break the session.
    }
  }

  private checkStopRequest(): void {
    const state = this.state;
    if (state === undefined || !state.holds || state.ctx === undefined) return;
    const prepared = this.prepare();
    if (prepared === undefined || !isStopRequested(readOwnLease(state.dir, state.sessionId))) {
      return;
    }
    this.stopSelf(state.ctx, prepared);
  }

  private publishStatus(ctx: ExtensionContext, prepared: Prepared): void {
    if (!ctx.hasUI) return;
    if (!prepared.config.enabled) {
      this.clearStatus(ctx);
      return;
    }
    const max = this.cap(prepared.config);
    const label: FocusState = prepared.state.holds
      ? "held"
      : prepared.live.length < max
        ? "ready"
        : "full";
    ctx.ui.setStatus(STATUS_KEY, statusText(prepared.live.length, max, label));
  }

  private clearStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  private fail(ctx: ExtensionContext, error: unknown): void {
    const state = this.state;
    if (state?.notifiedError) return;
    if (state !== undefined) state.notifiedError = true;
    try {
      ctx.ui.notify(failureNotice(describeError(error)), "warning");
    } catch {
      // Nothing left to report to.
    }
  }
}

export default function focusMode(pi: ExtensionAPI): void {
  new FocusModeSession(pi).register();
}
