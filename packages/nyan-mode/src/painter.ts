import { allocateImageId, getCapabilities, renderImage } from "@earendil-works/pi-tui";

import { getCachedNyanPng } from "./image.ts";
import { normalizeProgress } from "./progress.ts";
import type {
  NyanRunwayLayout,
  NyanRunwayPainter,
  NyanRunwayPainterOptions,
  RenderNyanRunwayOptions,
} from "./types.ts";
import { DEFAULT_ASSET_DIR } from "./xpm.ts";

const DEFAULT_ANIMATION_INTERVAL_MS = 100;
const DEFAULT_PROGRESS_SNAP = 0.001;
const DEFAULT_PROGRESS_EASE = 0.28;

type RenderRequester = {
  requestRender(): void;
};

export function createNyanRunwayPainter(
  tui: unknown,
  options: NyanRunwayPainterOptions = {},
): NyanRunwayPainter {
  return new InlineNyanRunwayPainter(toRenderRequester(tui), options);
}

function toRenderRequester(value: unknown): RenderRequester {
  if (!isRecord(value) || typeof value["requestRender"] !== "function") {
    throw new TypeError("Nyan Mode requires a Pi TUI renderer");
  }
  const requestRender = value["requestRender"];
  return {
    requestRender(): void {
      Reflect.apply(requestRender, value, []);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function renderAnimatedNyanRunway(
  painter: NyanRunwayPainter,
  options: RenderNyanRunwayOptions,
): string | undefined {
  const cells = Math.floor(options.cells);
  const minimumCells = options.minimumCells ?? 8;
  if (
    getCapabilities().images !== "kitty" ||
    cells < minimumCells ||
    options.startColumn === undefined
  ) {
    painter.clear();
    return undefined;
  }

  const layout: NyanRunwayLayout = { cells, startColumn: options.startColumn };
  if (options.percent !== undefined) layout.percent = options.percent;
  return painter.render(layout);
}

class InlineNyanRunwayPainter implements NyanRunwayPainter {
  private readonly imageId = allocateImageId();
  private readonly cache = new Map<string, string>();
  private readonly assetDir: string;
  private readonly minimumCells: number;
  private readonly frameIntervalMs: number;
  private readonly progressSnap: number;
  private readonly progressEase: number;
  private layout: NyanRunwayLayout | undefined;
  private currentProgress: number | undefined;
  private targetProgress = 0;
  private frame = 1;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(
    private readonly tui: RenderRequester,
    options: NyanRunwayPainterOptions,
  ) {
    this.assetDir = options.assetDir ?? DEFAULT_ASSET_DIR;
    this.minimumCells = options.minimumCells ?? 8;
    this.frameIntervalMs = options.frameIntervalMs ?? DEFAULT_ANIMATION_INTERVAL_MS;
    this.progressSnap = options.progressSnap ?? DEFAULT_PROGRESS_SNAP;
    this.progressEase = options.progressEase ?? DEFAULT_PROGRESS_EASE;
  }

  render(layout: NyanRunwayLayout): string | undefined {
    if (this.disposed || getCapabilities().images !== "kitty") return undefined;
    const cells = Math.max(this.minimumCells, Math.floor(layout.cells));
    this.layout = { ...layout, cells };
    this.targetProgress = normalizeProgress(layout.percent);
    this.currentProgress ??= this.targetProgress;
    this.ensureAnimation();

    const base64 = getCachedNyanPng(
      this.cache,
      this.assetDir,
      cells,
      this.currentProgress,
      this.frame,
    );
    if (!base64) return undefined;
    const result = renderImage(
      base64,
      { widthPx: cells * 8, heightPx: 15 },
      { maxWidthCells: cells, imageId: this.imageId, moveCursor: false },
    );
    return result?.rows === 1 ? result.sequence : undefined;
  }

  clear(): void {
    this.stopAnimation();
    this.layout = undefined;
    this.currentProgress = undefined;
    this.frame = 1;
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  debugInfo(): string {
    if (!this.layout) return "idle";
    return `inline cells=${String(this.layout.cells)} col=${String(this.layout.startColumn)} target=${String(Math.round(this.targetProgress * 100))}%`;
  }

  private ensureAnimation(): void {
    this.animationTimer ??= setInterval(() => {
      this.tick();
    }, this.frameIntervalMs);
  }

  private stopAnimation(): void {
    if (this.animationTimer) clearInterval(this.animationTimer);
    this.animationTimer = undefined;
  }

  private tick(): void {
    if (!this.layout || this.disposed) return;
    this.frame = this.frame >= 6 ? 1 : this.frame + 1;
    this.advanceProgress();
    this.tui.requestRender();
  }

  private advanceProgress(): void {
    const current = this.currentProgress ?? this.targetProgress;
    const delta = this.targetProgress - current;
    this.currentProgress =
      Math.abs(delta) <= this.progressSnap
        ? this.targetProgress
        : current + delta * this.progressEase;
  }
}
