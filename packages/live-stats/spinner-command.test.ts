import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { EmojiSpinnerState } from "./live-stats.ts";
import { handleSpinnerCommand, spinnerArgumentCompletions } from "./spinner-command.ts";

function commandContext(mode: "tui" | "print" = "tui", selected?: string) {
  const notify = vi.fn();
  const select = vi.fn().mockResolvedValue(selected);
  const setWorkingIndicator = vi.fn();
  const ctx = {
    mode,
    ui: {
      notify,
      select,
      setWorkingIndicator,
      theme: {
        bold: (text: string) => `<b>${text}</b>`,
        fg: (_color: string, text: string) => `<warning>${text}</warning>`,
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notify, select, setWorkingIndicator };
}

describe("spinner command", () => {
  it("offers random, current, and named argument completions", () => {
    expect(spinnerArgumentCompletions("")).toHaveLength(12);
    expect(spinnerArgumentCompletions("man")).toEqual([
      {
        value: "man-lifecycle",
        label: "👨 Man lifecycle",
        description: "220 ms per frame",
      },
    ]);
    expect(spinnerArgumentCompletions("missing")).toBeNull();
  });

  it("applies a named spinner immediately", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, notify, setWorkingIndicator } = commandContext();

    await handleSpinnerCommand("moon", ctx, state);

    expect(state.current.name).toBe("moon");
    expect(setWorkingIndicator).toHaveBeenCalledWith({
      frames: state.current.frames.map((frame) => `<b><warning>${frame}</warning></b>`),
      intervalMs: 80,
    });
    expect(notify).toHaveBeenCalledWith("Spinner set to: Moon phases", "info");
  });

  it("opens an emoji picker when no name is supplied", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, select } = commandContext("tui", "🌍 Rotating Earth");

    await handleSpinnerCommand("", ctx, state);

    expect(select).toHaveBeenCalledWith(
      "Spinner · Weather",
      expect.arrayContaining(["🎲 Random", "🌍 Rotating Earth", "👩 Woman lifecycle"]),
    );
    expect(state.current.name).toBe("earth");
  });

  it("leaves the current spinner unchanged when the picker is cancelled", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, notify, setWorkingIndicator } = commandContext();

    await handleSpinnerCommand("", ctx, state);

    expect(state.current.name).toBe("weather");
    expect(setWorkingIndicator).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports invalid names without changing the spinner", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, notify, setWorkingIndicator } = commandContext();

    await handleSpinnerCommand("missing", ctx, state);

    expect(state.current.name).toBe("weather");
    expect(setWorkingIndicator).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Unknown spinner"), "error");
  });

  it("shows the current spinner without reapplying it", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, notify, setWorkingIndicator } = commandContext();

    await handleSpinnerCommand("current", ctx, state);

    expect(setWorkingIndicator).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Spinner: Weather", "info");
  });

  it("chooses a fresh random spinner", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999_999);
    const state = new EmojiSpinnerState(() => 0);
    const { ctx } = commandContext();

    await handleSpinnerCommand("random", ctx, state);

    expect(state.current.name).toBe("woman-lifecycle");
    random.mockRestore();
  });

  it("requires a name when interactive selection is unavailable", async () => {
    const state = new EmojiSpinnerState(() => 0);
    const { ctx, notify, select } = commandContext("print");

    await handleSpinnerCommand("", ctx, state);

    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Use /spinner <name> outside interactive mode.", "warning");
  });
});
