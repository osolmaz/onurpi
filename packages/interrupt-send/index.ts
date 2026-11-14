import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installModeCapture } from "./capture.ts";
import {
  type InterruptEditor,
  type InterruptSession,
  type InterruptTarget,
  runInterruptSend,
} from "./interrupt.ts";

export const SHORTCUT = "ctrl+enter";

type Callable = (...args: unknown[]) => unknown;

function method(value: unknown, key: string): Callable | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "function" ? (candidate as Callable) : undefined;
}

function hasMethods(value: unknown, keys: readonly string[]): boolean {
  return keys.every((key) => method(value, key) !== undefined);
}

function isEditor(value: unknown): value is InterruptEditor {
  return hasMethods(value, ["getText", "setText"]);
}

function hasIdleFlags(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const streaming: unknown = Reflect.get(value, "isStreaming");
  const compacting: unknown = Reflect.get(value, "isCompacting");
  return typeof streaming === "boolean" && typeof compacting === "boolean";
}

function isSession(value: unknown): value is InterruptSession {
  return hasMethods(value, ["abort", "clearQueue", "followUp", "steer"]) && hasIdleFlags(value);
}

/** Build the send target from the live interactive mode, reading its private fields. */
export function interruptTarget(mode: object): InterruptTarget | undefined {
  const editor: unknown = Reflect.get(mode, "editor");
  const session: unknown = Reflect.get(mode, "session");
  const defaultEditor: unknown = Reflect.get(mode, "defaultEditor");
  const submit = method(defaultEditor, "onSubmit");
  if (!isEditor(editor) || !isSession(session) || submit === undefined) return undefined;
  const showStatus = method(mode, "showStatus");
  return {
    editor,
    session,
    showStatus: (message: string) => {
      showStatus?.call(mode, message);
    },
    submit: (text: string) => {
      void submit.call(defaultEditor, text);
    },
  };
}

export default function interruptSend(pi: ExtensionAPI): void {
  const capture = installModeCapture(
    InteractiveMode.prototype as unknown as Record<string, unknown>,
  );

  pi.registerShortcut(SHORTCUT, {
    description: "Interrupt the run and send, or send the next queued message",
    handler: () => {
      const mode = capture.current();
      const target = mode === undefined ? undefined : interruptTarget(mode);
      if (target !== undefined) void runInterruptSend(target);
    },
  });
  pi.on("session_shutdown", () => {
    capture.restore();
  });
}
