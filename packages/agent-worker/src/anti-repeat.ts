import type { Message } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord, MessageChange } from "@earendil-works/pi-durable";
import { correctionText } from "pi-anti-repeat";
import { RepeatDetector, isContinuationPrompt } from "pi-anti-repeat/core";
import type { Detection, DetectorOptions } from "pi-anti-repeat/core";

/**
 * The Anti-Repeat policy for this worker, as the Pi extension's default policy: correct the first
 * detection of an epoch, and stop after a second one.
 */
export type AntiRepeatFeedback = {
  readonly detection: Detection;
  /** True when the detection interrupted a streamed response, so the run needs an abort. */
  readonly activeResponse: boolean;
  readonly action: "correct" | "stop";
};

/**
 * Feeds one conversation's Durable events to `pi-anti-repeat/core` and carries out the policy.
 *
 * The plan's wiring: the worker watches the conversation with `watchEvents` and feeds the
 * `thinking_delta` events and the finished runs to the detector. A detection during a streamed
 * response asks the caller to abort the run, as the Pi extension cuts the response off, and a run
 * that such a detection aborted is discarded instead of counted. One watcher per conversation; all
 * state stays in memory.
 */
export class AntiRepeatWatcher {
  private readonly detector: RepeatDetector;
  private corrections = 0;
  private stopped = false;
  private nextRunContinuation = false;
  private skipRun = false;
  private turn: { messages: Message[]; toolResults: Message[] } = { messages: [], toolResults: [] };

  constructor(detectorOptions: DetectorOptions = {}) {
    this.detector = new RepeatDetector(detectorOptions);
  }

  /** Starts a new epoch unless the input only asks to keep going. */
  onNewInput(text: string): void {
    if (isContinuationPrompt(text)) {
      this.nextRunContinuation = true;
      return;
    }
    this.detector.reset();
    this.corrections = 0;
    this.stopped = false;
    this.nextRunContinuation = false;
    this.skipRun = false;
    this.turn = { messages: [], toolResults: [] };
  }

  /** Feeds one batch of watched events; returns the first policy decision it makes. */
  feed(events: readonly AgentEvent[]): AntiRepeatFeedback | null {
    for (const event of events) {
      const feedback = this.feedOne(event);
      if (feedback !== null) return feedback;
    }
    return null;
  }

  private feedOne(event: AgentEvent): AntiRepeatFeedback | null {
    return this.feedBoundary(event) ?? this.feedAccumulation(event);
  }

  /** Run boundaries, where the detectors compare finished runs. */
  private feedBoundary(event: AgentEvent): AntiRepeatFeedback | null {
    if (event.type === "run_start") return this.onRunStart();
    if (event.type === "turn_end") return this.closeTurn();
    if (event.type === "run_end") return this.closeRun();
    return null;
  }

  /** Streamed reasoning and the per-turn message record. */
  private feedAccumulation(event: AgentEvent): AntiRepeatFeedback | null {
    if (event.type === "message_update") return this.onMessageUpdate(event.changes);
    if (event.type === "message_end") return this.onMessageEnd(event.entry);
    if (event.type === "tool_execution_end") return this.onToolEnd(event.entry);
    return null;
  }

  private onRunStart(): AntiRepeatFeedback | null {
    this.turn = { messages: [], toolResults: [] };
    if (!this.detector.runOpen) {
      this.detector.startRun(this.nextRunContinuation);
      this.nextRunContinuation = false;
    }
    return null;
  }

  private onMessageUpdate(changes: readonly MessageChange[]): AntiRepeatFeedback | null {
    for (const change of changes) {
      if (change.type === "thinking_start") this.detector.startReasoning();
      if (change.type === "thinking_delta") {
        const detection = this.detector.observeReasoning(change.delta);
        if (detection !== null) return this.decide(detection, true);
      }
    }
    return null;
  }

  private onMessageEnd(entry: EntryRecord): AntiRepeatFeedback | null {
    const message = entry.model?.[0];
    if (message?.role === "assistant") this.turn.messages.push(...(entry.model ?? []));
    return null;
  }

  private onToolEnd(entry: EntryRecord | undefined): AntiRepeatFeedback | null {
    const message = entry?.model?.[0];
    if (message?.role === "toolResult") this.turn.toolResults.push(...(entry?.model ?? []));
    return null;
  }

  private closeTurn(): AntiRepeatFeedback | null {
    if (this.turn.messages.length === 0 && this.turn.toolResults.length === 0) return null;
    const messages = this.turn.messages;
    const toolResults = this.turn.toolResults;
    this.turn = { messages: [], toolResults: [] };
    if (!this.skipRun) this.detector.recordTurn(messages.at(-1), toolResults);
    return null;
  }

  private closeRun(): AntiRepeatFeedback | null {
    const wasSkipping = this.skipRun;
    this.skipRun = false;
    this.turn = { messages: [], toolResults: [] };
    if (!this.detector.runOpen) return null;
    if (wasSkipping) {
      this.detector.discardRun();
      return null;
    }
    const detection = this.detector.finishRun();
    if (detection === null) return null;
    return this.decide(detection, false);
  }

  private decide(detection: Detection, activeResponse: boolean): AntiRepeatFeedback {
    if (this.stopped) return { detection, activeResponse, action: "stop" };
    const action = this.corrections === 0 ? "correct" : "stop";
    this.corrections += 1;
    if (action === "stop") this.stopped = true;
    if (activeResponse) {
      // The aborted run must not count toward the detectors, as in the Pi extension.
      this.skipRun = true;
      this.detector.discardRun();
    }
    return { detection, activeResponse, action };
  }

  /** The corrective follow-up text, as the Pi extension sends it. */
  correction(detection: Detection): string {
    return correctionText(detection);
  }
}
