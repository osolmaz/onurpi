import { allocateImageId, deleteKittyImage, getCapabilities, renderImage } from "@earendil-works/pi-tui";
import { getCachedNyanPng, normalizeProgress } from "./image";
import type { NyanRunwayLayout, NyanRunwayPainter, NyanRunwayPainterOptions, RenderNyanRunwayOptions, TuiLike } from "./types";
import { DEFAULT_ASSET_DIR } from "./xpm";

const DEFAULT_ANIMATION_INTERVAL_MS = 100;
const DEFAULT_PROGRESS_SNAP = 0.001;
const DEFAULT_PROGRESS_EASE = 0.28;

/** Create the animated bitmap Nyan painter for a Pi footer/statusline. */
export function createNyanRunwayPainter(tui: TuiLike, options: NyanRunwayPainterOptions = {}): NyanRunwayPainter {
  return new KittyNyanRunwayPainter(tui, options);
}

/** Render reserved cells and schedule animated Nyan painting over them. */
export function renderAnimatedNyanRunway(painter: NyanRunwayPainter, options: RenderNyanRunwayOptions): string | undefined {
  const cells = Math.floor(options.cells);
  const minimumCells = options.minimumCells ?? 8;
  if (getCapabilities().images !== "kitty" || cells < minimumCells || options.startColumn === undefined) {
    painter.clear();
    return undefined;
  }

  painter.setTarget({ cells, startColumn: options.startColumn, percent: options.percent });
  return " ".repeat(cells);
}

class KittyNyanRunwayPainter implements NyanRunwayPainter {
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
  private imageVisible = false;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private paintTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly tui: TuiLike, options: NyanRunwayPainterOptions) {
    this.assetDir = options.assetDir ?? DEFAULT_ASSET_DIR;
    this.minimumCells = options.minimumCells ?? 8;
    this.frameIntervalMs = options.frameIntervalMs ?? DEFAULT_ANIMATION_INTERVAL_MS;
    this.progressSnap = options.progressSnap ?? DEFAULT_PROGRESS_SNAP;
    this.progressEase = options.progressEase ?? DEFAULT_PROGRESS_EASE;
  }

  setTarget(layout: NyanRunwayLayout): void {
    if (this.disposed) return;
    if (getCapabilities().images !== "kitty") {
      this.clear();
      return;
    }

    const cells = Math.max(this.minimumCells, Math.floor(layout.cells));
    this.layout = { ...layout, cells };
    this.targetProgress = normalizeProgress(layout.percent);
    if (this.currentProgress === undefined) this.currentProgress = this.targetProgress;
    this.ensureAnimation();
    this.schedulePaintAfterRender();
  }

  clear(): void {
    if (this.paintTimer) {
      clearTimeout(this.paintTimer);
      this.paintTimer = undefined;
    }
    this.stopAnimation();
    this.layout = undefined;
    this.currentProgress = undefined;

    if (this.imageVisible) {
      this.tui.terminal.write(`\x1b[?2026h${deleteKittyImage(this.imageId)}\x1b[?2026l`);
      this.imageVisible = false;
    }
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  debugInfo(): string {
    if (!this.layout) return this.imageVisible ? "visible-without-layout" : "idle";
    return `cells=${this.layout.cells} col=${this.layout.startColumn} target=${Math.round(this.targetProgress * 100)}%`;
  }

  private ensureAnimation(): void {
    if (this.animationTimer) return;
    this.animationTimer = setInterval(() => this.tick(), this.frameIntervalMs);
  }

  private stopAnimation(): void {
    if (!this.animationTimer) return;
    clearInterval(this.animationTimer);
    this.animationTimer = undefined;
  }

  private schedulePaintAfterRender(): void {
    if (this.paintTimer) return;
    this.paintTimer = setTimeout(() => {
      this.paintTimer = undefined;
      this.paint();
    }, 0);
  }

  private tick(): void {
    if (!this.layout || this.disposed) return;
    this.frame = this.frame >= 6 ? 1 : this.frame + 1;
    this.advanceProgress();
    this.paint();
  }

  private advanceProgress(): void {
    const current = this.currentProgress ?? this.targetProgress;
    const delta = this.targetProgress - current;
    this.currentProgress = Math.abs(delta) <= this.progressSnap ? this.targetProgress : current + delta * this.progressEase;
  }

  private paint(): void {
    if (!this.layout || this.disposed || getCapabilities().images !== "kitty") return;

    const row = this.footerScreenRow();
    if (row === undefined) return;

    const progress = this.currentProgress ?? this.targetProgress;
    const base64 = getCachedNyanPng(this.cache, this.assetDir, this.layout.cells, progress, this.frame);
    if (!base64) return;

    const result = renderImage(base64, { widthPx: this.layout.cells * 8, heightPx: 15 }, {
      maxWidthCells: this.layout.cells,
      imageId: this.imageId,
      moveCursor: false,
    });
    if (!result || result.rows !== 1) return;

    this.tui.terminal.write([
      "\x1b[?2026h",
      "\x1b7",
      this.imageVisible ? deleteKittyImage(this.imageId) : "",
      `\x1b[${row};${this.layout.startColumn}H`,
      result.sequence,
      "\x1b8",
      "\x1b[?2026l",
    ].join(""));
    this.imageVisible = true;
  }

  private footerScreenRow(): number | undefined {
    const previousLines = Array.isArray(this.tui.previousLines) ? this.tui.previousLines : undefined;
    const logicalRow = previousLines ? previousLines.length - 1 : undefined;
    if (logicalRow === undefined || logicalRow < 0) return undefined;

    const viewportTop = typeof this.tui.previousViewportTop === "number" ? this.tui.previousViewportTop : 0;
    const screenRow = logicalRow - viewportTop + 1;
    if (screenRow < 1 || screenRow > this.tui.terminal.rows) return undefined;
    return screenRow;
  }
}
