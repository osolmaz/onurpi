import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NyanRunwayPainter, TuiLike } from "./types.ts";

const tuiMocks = vi.hoisted(() => ({
  imageProtocol: "kitty" as string | null,
  renderImage: vi.fn(() => ({ rows: 1, sequence: "IMAGE" })),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  allocateImageId: () => 17,
  deleteKittyImage: (id: number) => `DELETE:${String(id)}`,
  getCapabilities: () => ({ images: tuiMocks.imageProtocol }),
  renderImage: tuiMocks.renderImage,
}));

import { createNyanRunwayPainter, renderAnimatedNyanRunway } from "./painter.ts";

function stubPainter(setTarget = vi.fn(), clear = vi.fn()): NyanRunwayPainter {
  return {
    setTarget,
    clear,
    dispose: vi.fn(),
    debugInfo: () => "stub",
  };
}

describe("animated runway reservation", () => {
  beforeEach(() => {
    tuiMocks.imageProtocol = "kitty";
  });

  it("reserves cells and updates a supported painter", () => {
    const setTarget = vi.fn();
    const painter = stubPainter(setTarget);
    expect(renderAnimatedNyanRunway(painter, { cells: 8.9, startColumn: 3, percent: 25 })).toBe(
      "        ",
    );
    expect(setTarget).toHaveBeenCalledWith({ cells: 8, startColumn: 3, percent: 25 });
  });

  it("clears the painter when rendering is unavailable", () => {
    const clear = vi.fn();
    const painter = stubPainter(vi.fn(), clear);
    tuiMocks.imageProtocol = null;
    expect(renderAnimatedNyanRunway(painter, { cells: 8, startColumn: 3 })).toBeUndefined();
    tuiMocks.imageProtocol = "kitty";
    expect(renderAnimatedNyanRunway(painter, { cells: 7, startColumn: 3 })).toBeUndefined();
    expect(renderAnimatedNyanRunway(painter, { cells: 8 })).toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(3);
  });
});

describe("Kitty Nyan painter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tuiMocks.imageProtocol = "kitty";
    tuiMocks.renderImage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("paints, animates, and clears a footer image", () => {
    const writes: string[] = [];
    const tui: TuiLike = {
      previousLines: [],
      previousViewportTop: 3,
      terminal: { rows: 1, write: (data) => writes.push(data) },
    };
    const painter = createNyanRunwayPainter(tui, { frameIntervalMs: 100 });
    tui.previousLines = ["chat", "footer"];
    tui.previousViewportTop = 0;
    tui.terminal.rows = 10;

    painter.setTarget({ cells: 8, startColumn: 3, percent: 50 });
    vi.advanceTimersByTime(0);
    expect(tuiMocks.renderImage).toHaveBeenCalledTimes(1);
    expect(writes[0]).toContain("\x1b[2;3HIMAGE");
    expect(painter.debugInfo()).toBe("cells=8 col=3 target=50%");

    vi.advanceTimersByTime(100);
    expect(tuiMocks.renderImage).toHaveBeenCalledTimes(2);
    expect(writes.at(-1)).toContain("DELETE:17");

    painter.clear();
    expect(painter.debugInfo()).toBe("idle");
    expect(writes.at(-1)).toContain("DELETE:17");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not paint outside the visible viewport or after disposal", () => {
    const write = vi.fn();
    const painter = createNyanRunwayPainter({
      previousLines: ["chat", "footer"],
      previousViewportTop: 5,
      terminal: { rows: 2, write },
    });
    painter.setTarget({ cells: 8, startColumn: 1 });
    vi.advanceTimersByTime(0);
    expect(write).not.toHaveBeenCalled();

    painter.dispose();
    painter.setTarget({ cells: 8, startColumn: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
