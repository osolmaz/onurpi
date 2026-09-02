import { encode } from "./response.ts";
import { unescapeChars } from "./unescape.ts";

export const COMMAND_INPUT_EVENT = "unified-exec:before-input";

export type CommandInputArguments = Readonly<{
  chars?: string | undefined;
  chars_b64?: string | undefined;
}>;

export type CommandInputEvent = {
  readonly toolCallId: string;
  readonly sessionId: number;
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly tty: boolean;
  readonly bytes: Uint8Array;
  reject(error: unknown): void;
};

export type PrepareCommandInput = (event: CommandInputEvent) => void;

const rejections = new WeakMap<CommandInputEvent, Error>();

// eslint-disable-next-line complexity -- Text and exact base64 input are mutually exclusive formats.
export function resolveCommandInput(args: CommandInputArguments): Uint8Array | undefined {
  const hasChars = typeof args.chars === "string" && args.chars.length > 0;
  const hasBase64 = typeof args.chars_b64 === "string" && args.chars_b64.length > 0;
  if (hasChars && hasBase64) {
    throw new Error("write_stdin: pass either `chars` or `chars_b64`, not both.");
  }
  if (hasBase64 && args.chars_b64) {
    const value = args.chars_b64.replace(/\s+/g, "");
    const completeBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!value || !completeBase64.test(value)) {
      throw new Error("write_stdin: `chars_b64` is not valid base64.");
    }
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (hasChars && args.chars) return encode(unescapeChars(args.chars));
  return undefined;
}

function rejectionError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`unified-exec: command input rejected: ${String(error)}`);
}

// eslint-disable-next-line complexity -- Public event-bus values require full structural validation.
export function isCommandInputEvent(value: unknown): value is CommandInputEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event["toolCallId"] === "string" &&
    typeof event["sessionId"] === "number" &&
    Number.isSafeInteger(event["sessionId"]) &&
    typeof event["command"] === "string" &&
    typeof event["cwd"] === "string" &&
    typeof event["shell"] === "string" &&
    typeof event["tty"] === "boolean" &&
    event["bytes"] instanceof Uint8Array &&
    typeof event["reject"] === "function"
  );
}

export function commandInputEvent(
  toolCallId: string,
  sessionId: number,
  command: string,
  cwd: string,
  shell: string,
  tty: boolean,
  bytes: Uint8Array,
): CommandInputEvent {
  const event: CommandInputEvent = {
    toolCallId,
    sessionId,
    command,
    cwd,
    shell,
    tty,
    bytes: bytes.slice(),
    reject: (error) => {
      rejections.set(event, rejectionError(error));
    },
  };
  return event;
}

export function throwIfCommandInputRejected(event: CommandInputEvent): void {
  const error = rejections.get(event);
  if (error) throw error;
}
