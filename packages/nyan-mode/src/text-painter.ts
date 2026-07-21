import type { CatMood } from "./cat-state.ts";
import { renderTextNyan } from "./text-runway.ts";

export type TextNyanPainter = {
  clear(): void;
  debugInfo(): string;
  dispose(): void;
  render(cells: number, percent: number | null | undefined, mood: CatMood): string;
  setStreaming(streaming: boolean): void;
};

export function createTextNyanPainter(
  requestRender: () => void,
  frameIntervalMs = 500,
): TextNyanPainter {
  let disposed = false;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const clear = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
    frame = 0;
  };

  return {
    clear,
    debugInfo(): string {
      return `frame=${String(frame)} animated=${String(timer !== undefined)}`;
    },
    dispose(): void {
      disposed = true;
      clear();
    },
    render(cells: number, percent: number | null | undefined, mood: CatMood): string {
      return renderTextNyan(cells, percent, { mood, animationFrame: frame });
    },
    setStreaming(streaming: boolean): void {
      if (!streaming || disposed || frameIntervalMs <= 0) {
        clear();
        return;
      }
      if (timer) return;
      timer = setInterval(() => {
        frame += 1;
        requestRender();
      }, frameIntervalMs);
    },
  };
}
