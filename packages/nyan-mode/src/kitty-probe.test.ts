import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tuiMocks = vi.hoisted(() => ({
  capabilities: { images: null as "kitty" | null, trueColor: true, hyperlinks: false },
  setCapabilities: vi.fn(),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  getCapabilities: () => tuiMocks.capabilities,
  setCapabilities: tuiMocks.setCapabilities,
}));

import {
  ensureKittyGraphics,
  isKittyGraphicsVerified,
  KITTY_GRAPHICS_QUERY,
} from "./kitty-probe.ts";

class ProbeInput {
  private listener: ((data: unknown) => void) | undefined;

  emit(data: unknown): void {
    this.listener?.(data);
  }

  off(_event: "data", listener: (data: unknown) => void): void {
    if (this.listener === listener) this.listener = undefined;
  }

  on(_event: "data", listener: (data: unknown) => void): void {
    this.listener = listener;
  }
}

describe("Kitty graphics probe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tuiMocks.capabilities = { images: null, trueColor: true, hyperlinks: false };
    tuiMocks.setCapabilities.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enables Kitty rendering after a terminal acknowledgement", async () => {
    const input = new ProbeInput();
    const write = vi.fn(() => {
      input.emit(Buffer.from("\x1b_Gi=2147483646;OK\x1b\\"));
    });

    await expect(ensureKittyGraphics({ terminal: { write } }, input, 500)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(KITTY_GRAPHICS_QUERY);
    expect(tuiMocks.setCapabilities).toHaveBeenCalledWith({
      images: "kitty",
      trueColor: true,
      hyperlinks: false,
    });
    expect(isKittyGraphicsVerified()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out safely when the terminal does not answer", async () => {
    const input = new ProbeInput();
    const result = ensureKittyGraphics({ write: vi.fn() }, input, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(false);
    expect(tuiMocks.setCapabilities).not.toHaveBeenCalled();
    expect(isKittyGraphicsVerified()).toBe(false);
  });

  it("verifies end-to-end support even when the environment reports Kitty", async () => {
    tuiMocks.capabilities = { images: "kitty", trueColor: true, hyperlinks: true };
    const input = new ProbeInput();
    const write = vi.fn(() => {
      input.emit("\x1b_Gi=2147483646;OK\x1b\\");
    });
    await expect(ensureKittyGraphics({ write }, input, 500)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(KITTY_GRAPHICS_QUERY);

    await expect(ensureKittyGraphics(undefined, new ProbeInput(), 500)).resolves.toBe(false);
    expect(isKittyGraphicsVerified()).toBe(false);
    await expect(ensureKittyGraphics({ write: vi.fn() }, new ProbeInput(), 0)).resolves.toBe(false);
  });
});
