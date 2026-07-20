import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NyanRunwayPainter } from "./types.ts";

const tuiMocks = vi.hoisted(() => ({
  imageProtocol: "kitty" as string | null,
  renderImage: vi.fn(() => ({ rows: 1, sequence: "IMAGE" })),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  allocateImageId: () => 17,
  getCapabilities: () => ({ images: tuiMocks.imageProtocol }),
  renderImage: tuiMocks.renderImage,
}));

import { createNyanRunwayPainter, renderAnimatedNyanRunway } from "./painter.ts";

function stubPainter(
  render: NyanRunwayPainter["render"] = vi.fn(() => "IMAGE"),
  clear: NyanRunwayPainter["clear"] = vi.fn(),
): NyanRunwayPainter {
  return {
    render,
    clear,
    dispose: vi.fn(),
    debugInfo: () => "stub",
  };
}

describe("animated runway rendering", () => {
  beforeEach(() => {
    tuiMocks.imageProtocol = "kitty";
  });

  it("returns the image sequence for inline footer composition", () => {
    const render = vi.fn(() => "IMAGE");
    const painter = stubPainter(render);
    expect(renderAnimatedNyanRunway(painter, { cells: 8.9, startColumn: 3, percent: 25 })).toBe(
      "IMAGE",
    );
    expect(render).toHaveBeenCalledWith({ cells: 8, startColumn: 3, percent: 25 });
  });

  it("clears the painter when rendering is unavailable", () => {
    const clear = vi.fn();
    const painter = stubPainter(
      vi.fn(() => undefined),
      clear,
    );
    tuiMocks.imageProtocol = null;
    expect(renderAnimatedNyanRunway(painter, { cells: 8, startColumn: 3 })).toBeUndefined();
    tuiMocks.imageProtocol = "kitty";
    expect(renderAnimatedNyanRunway(painter, { cells: 7, startColumn: 3 })).toBeUndefined();
    expect(renderAnimatedNyanRunway(painter, { cells: 8 })).toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(3);
  });
});

describe("inline Nyan painter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tuiMocks.imageProtocol = "kitty";
    tuiMocks.renderImage.mockClear();
    tuiMocks.renderImage.mockReturnValue({ rows: 1, sequence: "IMAGE" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders inline, animates through TUI renders, and clears its timer", () => {
    const requestRender = vi.fn();
    const painter = createNyanRunwayPainter({ requestRender }, { frameIntervalMs: 100 });

    expect(painter.render({ cells: 8, startColumn: 3, percent: 50 })).toBe("IMAGE");
    expect(tuiMocks.renderImage).toHaveBeenCalledTimes(1);
    expect(painter.debugInfo()).toBe("inline cells=8 col=3 target=50%");

    vi.advanceTimersByTime(100);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(painter.render({ cells: 10, startColumn: 4, percent: 75 })).toBe("IMAGE");
    expect(tuiMocks.renderImage).toHaveBeenCalledTimes(2);

    painter.clear();
    expect(painter.debugInfo()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops rendering after disposal and rejects an unsupported TUI", () => {
    const painter = createNyanRunwayPainter({ requestRender: vi.fn() });
    painter.dispose();
    expect(painter.render({ cells: 8, startColumn: 1 })).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => createNyanRunwayPainter({})).toThrow("Pi TUI renderer");
  });
});
