import { StringDecoder } from "node:string_decoder";

const MAX_EVENT_LINE_BYTES = 2 * 1024 * 1024;
const MAX_FINAL_TEXT_CHARS = 512 * 1024;

export type PiRunResult = {
  readonly finalText: string;
  readonly sawAgentEnd: boolean;
};

export class PiEventCollector {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private finalText: string | undefined;
  private terminalError: string | undefined;
  private agentEnded = false;

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

  finish(): PiRunResult {
    this.feedText(this.decoder.end());
    if (this.buffer.trim() !== "") this.consume(this.buffer);
    this.buffer = "";
    if (!this.agentEnded) throw new Error("Pi exited before agent_end");
    if (this.finalText === undefined) {
      throw new Error(this.terminalError ?? "Pi produced no completed assistant response");
    }
    return { finalText: this.finalText, sawAgentEnd: true };
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
  }

  private consumeMessage(message: unknown): void {
    if (!isRecord(message) || message["role"] !== "assistant") return;
    const stopReason = message["stopReason"];
    if (stopReason === "stop") {
      const text = assistantText(message["content"]);
      if (text.length > MAX_FINAL_TEXT_CHARS) throw new Error("review output exceeded size limit");
      if (text.trim() !== "") this.finalText = text;
      this.terminalError = undefined;
      return;
    }
    if (stopReason === "error" || stopReason === "aborted") {
      this.terminalError = optionalError(message["errorMessage"], stopReason);
    }
  }
}

function assistantText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!isRecord(block) || block["type"] !== "text" || typeof block["text"] !== "string") {
        return [];
      }
      return [block["text"]];
    })
    .join("");
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
