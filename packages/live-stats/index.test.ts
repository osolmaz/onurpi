import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import liveStats from "./index.ts";
import { BRAILLE_SPINNERS } from "./spinners.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => void;

type Harness = {
  frames: string[][];
  messages: (string | undefined)[];
  ctx: ExtensionContext;
  send: (name: string, event?: unknown) => void;
};

const ESCAPES = /\x1b\[[0-9;]*m/gu;

function createHarness(): Harness {
  const handlers = new Map<string, Handler>();
  const frames: string[][] = [];
  const messages: (string | undefined)[] = [];
  const theme = {
    bold: (text: string): string => `\x1b[1m${text}\x1b[22m`,
    getColorMode: () => "truecolor",
    getFgAnsi: () => "\x1b[38;2;250;179;135m",
    fg: (_color: string, text: string): string => text,
  };
  const ctx = {
    mode: "tui",
    isIdle: () => true,
    ui: {
      theme,
      setWorkingIndicator: (options: { frames: string[] }) => frames.push([...options.frames]),
      setWorkingMessage: (message?: string) => messages.push(message),
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  liveStats(pi);

  return {
    frames,
    messages,
    ctx,
    send: (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx),
  };
}

/** The id of the spinner whose frames match the styled frames Pi was given. */
function spinnerIdOf(frames: readonly string[]): string | undefined {
  const plain = frames.map((frame) => frame.replaceAll(ESCAPES, "")).join("|");
  return BRAILLE_SPINNERS.find((spinner) => spinner.frames.join("|") === plain)?.id;
}

/** The text the bold escape covers. */
function boldTextOf(message: string): string {
  const start = message.indexOf("\x1b[1m");
  const end = message.indexOf("\x1b[22m");
  if (start === -1 || end === -1) return "";
  return message.slice(start + "\x1b[1m".length, end).replaceAll(ESCAPES, "");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("liveStats", () => {
  it("picks a spinner from the set when a session starts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const harness = createHarness();

    harness.send("session_start");

    expect(harness.frames).toHaveLength(1);
    expect(spinnerIdOf(harness.frames[0] ?? [])).toBe(BRAILLE_SPINNERS[0]?.id);
    expect(harness.frames[0]).toHaveLength(BRAILLE_SPINNERS[0]?.frames.length ?? 0);
  });

  it("keeps the same spinner for the rest of the session", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    const harness = createHarness();

    harness.send("session_start");
    const chosen = spinnerIdOf(harness.frames[0] ?? []);
    harness.send("message_start", { message: { role: "assistant" } });
    harness.send("message_start", { message: { role: "user" } });
    harness.send("agent_start");
    vi.advanceTimersByTime(1_000);
    harness.send("agent_end");

    expect(harness.frames).toHaveLength(1);
    expect(chosen).not.toBeUndefined();
    expect(spinnerIdOf(harness.frames[0] ?? [])).toBe(chosen);
  });

  it("picks a fresh spinner for the next session", () => {
    const random = vi.spyOn(Math, "random");
    const harness = createHarness();

    random.mockReturnValue(0);
    harness.send("session_start");
    expect(spinnerIdOf(harness.frames[0] ?? [])).toBe(BRAILLE_SPINNERS[0]?.id);

    harness.send("session_shutdown");
    random.mockReturnValue(0.9999);
    harness.send("session_start");

    expect(harness.frames).toHaveLength(2);
    expect(spinnerIdOf(harness.frames[1] ?? [])).toBe(BRAILLE_SPINNERS.at(-1)?.id);
  });

  it("writes the working line without an ellipsis and with plain statistics", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const harness = createHarness();

    harness.send("session_start");
    harness.send("agent_start");
    vi.advanceTimersByTime(60);
    const message = harness.messages.at(-1) ?? "";

    expect(message.replaceAll(ESCAPES, "")).toBe("Working (0s · 0 out · — tok/s)");
    expect(message).not.toContain("…");
    expect(boldTextOf(message)).toBe("Working");
  });

  it("clears the working line when the session settles", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.send("agent_settled");

    expect(harness.messages.at(-1)).toBeUndefined();
  });
});
