/**
 * Steer gate: a human steering message ends an attached wait early.
 *
 * Pi delivers a queued steer only after the whole tool batch finishes, so a
 * long `write_stdin` poll would otherwise hold the steer for the full wait.
 * The gate turns "a human steer is queued" into one shared AbortSignal that
 * every live wait listens to:
 *
 *   input(streamingBehavior: "steer")  → confirm with ctx.hasPendingMessages()
 *                                        (a later input handler may have
 *                                        handled and dropped the text)
 *   confirmed                          → pending++, abort the shared signal
 *   message_start(role: "user")        → Pi delivered one queued message:
 *                                        pending-- (floored at 0)
 *   agent_settled / session change     → reset
 *
 * While nothing is pending the signal is fresh (not aborted). A wait never
 * kills the child; it only returns early with the output gathered so far.
 * Custom messages that extensions queue with sendMessage fire no `input`
 * event and are intentionally not interrupts.
 */

import type { ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";

export const STEER_INTERRUPT_ENV = "PI_UNIFIED_EXEC_STEER_INTERRUPT";

/** Shown to the model when a wait returns because the human steered. */
export const STEER_NOTE =
  "returned early: the user sent a steering message, which Pi delivers next. " +
  "The process was not interrupted — it is still running and still buffering " +
  "output, so the next poll returns everything produced since. Read the steer " +
  "first, then re-poll this session_id only if it is still relevant (optionally " +
  'with on_exit: "wake" to be woken when it exits).';

/** Thrown for nested (codemode) calls while a steer is pending, so a polling script ends. */
export const STEER_NESTED_ERROR =
  "unified-exec: the user sent a steering message; this script call was stopped so Pi can deliver it. " +
  "Do not retry it — end the polling loop and read the steer. Sessions were not killed and keep " +
  "buffering output; re-poll those still relevant afterwards.";

/** The part of Pi's ExtensionContext that the gate consults. */
export type PendingProbe = Pick<ExtensionContext, "hasPendingMessages">;

export type SteerGateOptions = Readonly<{
  enabled?: boolean;
  /** Interval between confirmation probes after a steer input (ms). */
  confirmIntervalMs?: number;
  /** Stop confirming after this long: the input was handled or dropped. */
  confirmWindowMs?: number;
}>;

/** Whether steer interrupts are enabled (default on; `0` opts out). */
export function steerInterruptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STEER_INTERRUPT_ENV] !== "0";
}

/** Nested calls made through ctx.executeTool() carry `<parent>/<n>` ids. */
export function isNestedToolCall(toolCallId: string): boolean {
  return toolCallId.includes("/");
}

/** The note of a live session whose wait ended because the human steered. */
export function steeredNote(heldOpenNote: string | undefined): string {
  return heldOpenNote ? `${STEER_NOTE} Also: ${heldOpenNote}` : STEER_NOTE;
}

/**
 * Whether a collect that stopped before its deadline stopped for a steer.
 * Esc (the tool-call abort) wins, and a reached deadline is not a steer.
 */
export function endedBySteer(
  steerSignal: AbortSignal | undefined,
  abortSignal: AbortSignal | undefined,
  deadlineMs: number,
): boolean {
  return steerSignal?.aborted === true && abortSignal?.aborted !== true && Date.now() < deadlineMs;
}

export class SteerGate {
  readonly enabled: boolean;
  private readonly confirmIntervalMs: number;
  private readonly confirmWindowMs: number;
  private pending = 0;
  private controller = new AbortController();
  private readonly confirmTimers = new Set<NodeJS.Timeout>();

  constructor(options: SteerGateOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.confirmIntervalMs = options.confirmIntervalMs ?? 10;
    this.confirmWindowMs = options.confirmWindowMs ?? 1000;
  }

  /** Aborted while a human steer is queued; replaced once it is delivered. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get pendingCount(): number {
    return this.pending;
  }

  /**
   * Whether a steer is queued. A stale count (Pi's queue is already empty,
   * for example because the user cleared it) is dropped first.
   */
  isPending(probe: PendingProbe): boolean {
    if (this.pending > 0 && !probe.hasPendingMessages()) {
      // Keep the confirmations in flight: a newer steer may still arrive.
      this.pending = 0;
      this.freshSignal();
    }
    return this.pending > 0;
  }

  /** Pi's `input` event: a steer typed or sent while the agent runs. */
  observeInput(event: Pick<InputEvent, "streamingBehavior">, probe: PendingProbe): void {
    if (event.streamingBehavior === "steer") this.onSteerInput(probe);
  }

  /** Pi's `message_start` event: Pi delivered a queued user message. */
  observeMessageStart(event: Readonly<{ message: Readonly<{ role: string }> }>): void {
    if (event.message.role === "user") this.onUserMessageDelivered();
  }

  /**
   * Called from Pi's `input` event for a steer. The event fires before Pi
   * queues the text, so the gate confirms against Pi's queue afterwards.
   */
  onSteerInput(probe: PendingProbe): void {
    if (!this.enabled) return;
    this.scheduleConfirmation(probe, Date.now(), 0);
  }

  /** Mark one human steer as queued and release every live wait. */
  markPending(): void {
    if (!this.enabled) return;
    this.pending++;
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  /** Pi delivered a queued user message (a steer or a follow-up). */
  onUserMessageDelivered(): void {
    if (this.pending === 0) return;
    this.pending--;
    if (this.pending === 0) this.freshSignal();
  }

  /** Forget everything (run settled, session change, shutdown). */
  reset(): void {
    for (const timer of this.confirmTimers) clearTimeout(timer);
    this.confirmTimers.clear();
    this.pending = 0;
    this.freshSignal();
  }

  private scheduleConfirmation(probe: PendingProbe, startedAt: number, delayMs: number): void {
    const timer = setTimeout(() => {
      this.confirmTimers.delete(timer);
      this.confirm(probe, startedAt);
    }, delayMs);
    timer.unref();
    this.confirmTimers.add(timer);
  }

  private confirm(probe: PendingProbe, startedAt: number): void {
    let queued: boolean;
    try {
      queued = probe.hasPendingMessages();
    } catch {
      return; // A stale context (the session was replaced): drop the steer.
    }
    if (queued) this.markPending();
    else if (Date.now() - startedAt < this.confirmWindowMs)
      this.scheduleConfirmation(probe, startedAt, this.confirmIntervalMs);
  }

  private freshSignal(): void {
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }
}

/**
 * The steer signal for one exec_command or write_stdin call. A top-level call
 * made while a steer is already queued returns promptly, because its wait sees
 * an aborted signal. A nested codemode call throws instead: otherwise a script
 * that polls in a loop would spin on instant returns and still hold the steer.
 */
export function steerSignalFor(
  gate: SteerGate,
  toolCallId: string,
  probe: PendingProbe,
): AbortSignal | undefined {
  if (!gate.enabled) return undefined;
  // isPending runs for every call: it also drops a stale count, so that a
  // top-level call does not return at once for a steer that is gone.
  if (gate.isPending(probe) && isNestedToolCall(toolCallId)) throw new Error(STEER_NESTED_ERROR);
  return gate.signal;
}
