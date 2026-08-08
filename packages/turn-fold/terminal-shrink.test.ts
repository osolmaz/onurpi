import { describe, expect, it } from "vitest";

import { type Component, type Terminal, TuiMainScreen } from "@earendil-works/pi-tui";

import { enableTranscriptShrinkClearing } from "./shortcut-editor.ts";

const CLEAR_SCREEN_AND_SCROLLBACK = "\u001b[2J\u001b[H\u001b[3J";

class RecordingTerminal implements Terminal {
  readonly columns = 100;
  readonly kittyProtocolActive = false;
  readonly operations: string[] = [];
  readonly rows = 30;
  readonly writes: string[] = [];

  clearFromCursor(): void {
    this.operations.push("clearFromCursor");
  }

  clearLine(): void {
    this.operations.push("clearLine");
  }

  clearScreen(): void {
    this.operations.push("clearScreen");
  }

  async drainInput(): Promise<void> {
    await Promise.resolve();
  }

  hideCursor(): void {
    this.operations.push("hideCursor");
  }

  moveBy(lines: number): void {
    this.operations.push(`moveBy:${String(lines)}`);
  }

  setProgress(active: boolean): void {
    this.operations.push(`setProgress:${String(active)}`);
  }

  setTitle(title: string): void {
    this.operations.push(`setTitle:${title}`);
  }

  showCursor(): void {
    this.operations.push("showCursor");
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.operations.push(`start:${String(onInput.length)}:${String(onResize.length)}`);
  }

  stop(): void {
    this.operations.push("stop");
  }

  write(data: string): void {
    this.writes.push(data);
  }
}

class MutableTranscript implements Component {
  lines: string[];
  private invalidations = 0;

  constructor(lineCount: number) {
    this.lines = Array.from({ length: lineCount }, (_, index) => `transcript row ${String(index)}`);
  }

  invalidate(): void {
    this.invalidations += 1;
  }

  render(): string[] {
    return this.lines;
  }
}

async function waitForRender(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
}

describe("Turn Fold terminal shrinking", () => {
  it("clears obsolete screen and scrollback rows when compact scope shortens the transcript", async () => {
    const terminal = new RecordingTerminal();
    const transcript = new MutableTranscript(128);
    const tui = new TuiMainScreen(terminal);
    const restoreShrinkClearing = enableTranscriptShrinkClearing(tui);
    tui.addChild(transcript);

    try {
      tui.start();
      await waitForRender();
      terminal.writes.length = 0;

      transcript.lines = ["user prompt", "settled summary", "final response"];
      tui.requestRender();
      await waitForRender();

      expect(terminal.writes.join("")).toContain(CLEAR_SCREEN_AND_SCROLLBACK);
      restoreShrinkClearing();
      expect(tui.getClearOnShrink()).toBe(false);
    } finally {
      restoreShrinkClearing();
      tui.stop();
    }
  });
});
