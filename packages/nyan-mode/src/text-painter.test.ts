import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTextNyanPainter } from "./text-painter.ts";

const ESCAPE = String.fromCharCode(27);
const ANSI_FOREGROUND = new RegExp(`${ESCAPE}\\[(?:38;2;\\d+;\\d+;\\d+|39|90)m`, "gu");

function plain(text: string): string {
  return text.replace(ANSI_FOREGROUND, "");
}

describe("text Nyan painter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests frames while streaming and stops cleanly", async () => {
    const requestRender = vi.fn();
    const painter = createTextNyanPainter(requestRender, 500);
    const initial = painter.render(30, 50, "dancing");

    painter.setStreaming(true);
    painter.setStreaming(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(painter.debugInfo()).toBe("frame=1 animated=true");
    expect(plain(painter.render(30, 50, "dancing"))).not.toBe(plain(initial));

    painter.setStreaming(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(painter.debugInfo()).toBe("frame=0 animated=false");
  });

  it("disposes idempotently and cannot restart", async () => {
    const requestRender = vi.fn();
    const painter = createTextNyanPainter(requestRender, 100);
    painter.setStreaming(true);
    painter.dispose();
    painter.dispose();
    painter.setStreaming(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not schedule a non-positive interval", () => {
    const painter = createTextNyanPainter(vi.fn(), 0);
    painter.setStreaming(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
