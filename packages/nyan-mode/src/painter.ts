import {
  allocateImageId,
  deleteKittyImage,
  getCapabilities,
  renderImage,
} from "@earendil-works/pi-tui";

import { getCachedNyanPng } from "./image.ts";
import { normalizeProgress } from "./progress.ts";
import type {
  NyanRunwayLayout,
  NyanRunwayPainter,
  NyanRunwayPainterOptions,
  RenderNyanRunwayOptions,
  TuiLike,
} from "./types.ts";
import { DEFAULT_ASSET_DIR } from "./xpm.ts";

const DEFAULT_ANIMATION_INTERVAL_MS = 100;
const DEFAULT_PROGRESS_SNAP = 0.001;
const DEFAULT_PROGRESS_EASE = 0.28;

export function createNyanRunwayPainter(
  tui: unknown,
  options: NyanRunwayPainterOptions = {},
): NyanRunwayPainter {
  return new KittyNyanRunwayPainter(toTuiLike(tui), options);
}

function toTuiLike(value: unknown): TuiLike {
  if (!isRecord(value) || !isRecord(value["terminal"])) {
    throw new TypeError("Nyan Mode requires a Pi TUI terminal");
  }
  const terminal = value["terminal"];
  const rows = terminal["rows"];
  const write = terminal["write"];
  if (typeof rows !== "number" || !Number.isFinite(rows) || typeof write !== "function") {
    throw new TypeError("Nyan Mode requires a writable Pi TUI terminal");
  }

  const tui: TuiLike = {
    terminal: {
      rows,
      write(data: string): void {
        Reflect.apply(write, terminal, [data]);
      },
    },
  };
  attachPreviousLines(tui, value["previousLines"]);
  attachViewportTop(tui, value["previousViewportTop"]);
  return tui;
}

function attachPreviousLines(tui: TuiLike, value: unknown): void {
  if (!Array.isArray(value)) return;
  if (!value.every((line) => typeof line === "string")) return;
  tui.previousLines = value;
}

function attachViewportTop(tui: TuiLike, value: unknown): void {
  if (typeof value !== "number") return;
  if (!Number.isFinite(value)) return;
  tui.previousViewportTop = value;
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
  painter.setTarget(layout);
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

  constructor(
    private readonly tui: TuiLike,
    options: NyanRunwayPainterOptions,
  ) {
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

    this.layout = { ...layout, cells: Math.max(this.minimumCells, Math.floor(layout.cells)) };
    this.targetProgress = normalizeProgress(layout.percent);
    this.currentProgress ??= this.targetProgress;
    this.ensureAnimation();
    this.schedulePaintAfterRender();
  }

  clear(): void {
    if (this.paintTimer) clearTimeout(this.paintTimer);
    this.paintTimer = undefined;
    this.stopAnimation();
    this.layout = undefined;
    this.currentProgress = undefined;
    this.clearImage();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  debugInfo(): string {
    if (!this.layout) return this.imageVisible ? "visible-without-layout" : "idle";
    return `cells=${String(this.layout.cells)} col=${String(this.layout.startColumn)} target=${String(Math.round(this.targetProgress * 100))}%`;
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
    this.currentProgress =
      Math.abs(delta) <= this.progressSnap
        ? this.targetProgress
        : current + delta * this.progressEase;
  }

  private paint(): void {
    const layout = this.paintLayout();
    if (!layout) return;
    const row = this.footerScreenRow();
    if (row === undefined) return;

    const progress = this.currentProgress ?? this.targetProgress;
    const base64 = getCachedNyanPng(this.cache, this.assetDir, layout.cells, progress, this.frame);
    if (!base64) return;

    const result = renderImage(
      base64,
      { widthPx: layout.cells * 8, heightPx: 15 },
      { maxWidthCells: layout.cells, imageId: this.imageId, moveCursor: false },
    );
    if (result === null) return;
    if (result.rows !== 1) return;
    this.paintImage(row, result.sequence);
  }

  private paintLayout(): NyanRunwayLayout | undefined {
    if (this.disposed) return undefined;
    if (getCapabilities().images !== "kitty") return undefined;
    return this.layout;
  }

  private paintImage(row: number, sequence: string): void {
    this.tui.terminal.write(
      [
        "\x1b[?2026h",
        "\x1b7",
        this.imageVisible ? deleteKittyImage(this.imageId) : "",
        `\x1b[${String(row)};${String(this.layout?.startColumn ?? 1)}H`,
        sequence,
        "\x1b8",
        "\x1b[?2026l",
      ].join(""),
    );
    this.imageVisible = true;
  }

  private clearImage(): void {
    if (!this.imageVisible) return;
    this.tui.terminal.write(`\x1b[?2026h${deleteKittyImage(this.imageId)}\x1b[?2026l`);
    this.imageVisible = false;
  }

  private footerScreenRow(): number | undefined {
    const logicalRow = this.tui.previousLines?.length;
    if (logicalRow === undefined || logicalRow < 1) return undefined;
    const viewportTop = this.tui.previousViewportTop ?? 0;
    const screenRow = logicalRow - viewportTop;
    return screenRow >= 1 && screenRow <= this.tui.terminal.rows ? screenRow : undefined;
  }
}
