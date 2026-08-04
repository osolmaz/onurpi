import { initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { HistorySearch } from "./history-search.ts";
import { HistoryViewport } from "./history-viewport.ts";

initTheme("dark", false);

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  italic: (text: string) => text,
};

function largeHistory(count: number, reads?: { count: number }): readonly unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${String(index)}`,
    get message(): unknown {
      if (reads) reads.count += 1;
      return {
        content: index === 0 ? "oldest needle" : `entry ${String(index)}`,
        role: "assistant",
        timestamp: index,
      };
    },
    type: "message",
  }));
}

describe("Turn Fold history performance bounds", () => {
  it("keeps opening and navigation near the viewport", () => {
    const reads = { count: 0 };
    const viewport = new HistoryViewport(largeHistory(10_000, reads), theme);

    viewport.render(120, 30);
    for (let index = 0; index < 100; index += 1) viewport.moveBackward(1);
    viewport.render(120, 30);

    expect(reads.count).toBeLessThan(300);
    expect(viewport.cachedBlocks).toBeLessThanOrEqual(128);
  });

  it("limits each search slice while still reaching the whole branch", () => {
    const search = new HistorySearch(largeHistory(10_000));
    search.start("needle", "all");

    search.step(40, 8_000);
    expect(search.progress.scannedEntries).toBeLessThanOrEqual(40);

    let steps = 1;
    while (!search.complete && steps < 300) {
      search.step(40, 8_000);
      steps += 1;
    }

    expect(search.complete).toBe(true);
    expect(steps).toBeLessThanOrEqual(250);
    expect(search.results.map((result) => result.entryIndex)).toEqual([0]);
  });
});
