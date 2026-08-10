import { StringDecoder } from "node:string_decoder";

const MAX_EVENT_LINE_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_RESULT_CHARS = 512 * 1024;

export type PiRunResult = {
  readonly finalText: string;
  readonly sawAgentEnd: boolean;
};

export type PiRunMetrics = {
  readonly version: 1;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly observedProviders: readonly string[];
  readonly observedModels: readonly string[];
  readonly observedResponseModels: readonly string[];
};

export class PiEventCollector {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private finalText: string | undefined;
  private terminalError: string | undefined;
  private agentEnded = false;
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private reasoningTokens = 0;
  private totalTokens = 0;
  private costUsd = 0;
  private readonly observedProviders = new Set<string>();
  private readonly observedModels = new Set<string>();
  private readonly observedResponseModels = new Set<string>();

  feed(chunk: string | Buffer): void {
    this.feedText(typeof chunk === "string" ? chunk : this.decoder.write(chunk));
  }

  private feedText(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_EVENT_LINE_BYTES) {
      throw new Error("Pi emitted an oversized JSON event");
    }
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.consume(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  metrics(): PiRunMetrics {
    return {
      version: 1,
      requests: this.requests,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      reasoningTokens: this.reasoningTokens,
      totalTokens: this.totalTokens,
      costUsd: this.costUsd,
      observedProviders: [...this.observedProviders].sort(),
      observedModels: [...this.observedModels].sort(),
      observedResponseModels: [...this.observedResponseModels].sort(),
    };
  }

  finish(): PiRunResult {
    this.feedText(this.decoder.end());
    if (this.buffer.trim() !== "") this.consume(this.buffer);
    this.buffer = "";
    if (this.finalText === undefined) {
      if (!this.agentEnded) throw new Error("Pi exited before agent_end");
      throw new Error(this.terminalError ?? "Pi produced no submit_review result");
    }
    return { finalText: this.finalText, sawAgentEnd: this.agentEnded };
  }

  private consume(line: string): void {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Pi emitted invalid JSON: ${errorMessage(error)}`, { cause: error });
    }
    if (!isRecord(value) || typeof value["type"] !== "string") {
      throw new Error("Pi emitted an invalid event object");
    }
    if (value["type"] === "agent_end") this.agentEnded = true;
    if (value["type"] === "message_end") this.consumeMessage(value["message"]);
    if (value["type"] === "review_submission") this.consumeSubmission(value["review"]);
  }

  private consumeMessage(message: unknown): void {
    if (!isRecord(message) || message["role"] !== "assistant") return;
    this.consumeMetrics(message);
    const stopReason = message["stopReason"];
    if (stopReason === "error" || stopReason === "aborted") {
      this.terminalError = optionalError(message["errorMessage"], stopReason);
    }
  }

  private consumeSubmission(review: unknown): void {
    if (!isRecord(review)) throw new Error("Pi emitted an invalid review submission");
    const text = JSON.stringify(review);
    if (text.length > MAX_REVIEW_RESULT_CHARS) throw new Error("review output exceeded size limit");
    if (this.finalText !== undefined) throw new Error("Pi emitted more than one review submission");
    this.finalText = text;
    this.terminalError = undefined;
  }

  private consumeMetrics(message: Readonly<Record<string, unknown>>): void {
    addObservedString(message["provider"], this.observedProviders);
    addObservedString(message["model"], this.observedModels);
    addObservedString(message["responseModel"], this.observedResponseModels);
    const usage = message["usage"];
    if (usage === undefined) return;
    if (!isRecord(usage) || !isRecord(usage["cost"])) {
      throw new Error("Pi emitted invalid usage metrics");
    }
    this.requests += 1;
    this.inputTokens += metricNumber(usage["input"]);
    this.outputTokens += metricNumber(usage["output"]);
    this.cacheReadTokens += metricNumber(usage["cacheRead"]);
    this.cacheWriteTokens += metricNumber(usage["cacheWrite"]);
    this.reasoningTokens += optionalMetricNumber(usage["reasoning"]);
    this.totalTokens += metricNumber(usage["totalTokens"]);
    this.costUsd += metricNumber(usage["cost"]["total"]);
  }
}

function addObservedString(value: unknown, destination: Set<string>): void {
  if (typeof value === "string" && value !== "") destination.add(value);
}

function metricNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Pi emitted invalid usage metrics");
  }
  return value;
}

function optionalMetricNumber(value: unknown): number {
  return value === undefined ? 0 : metricNumber(value);
}

function optionalError(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : `Pi response ${fallback}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
