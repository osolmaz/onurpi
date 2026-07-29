export type Rgba = [number, number, number, number];
export type XpmImage = { width: number; height: number; pixels: Buffer };

export type TerminalLike = { columns: number; rows: number; write(data: string): void };
export type TuiLike = {
  terminal: TerminalLike;
  previousLines?: string[];
  previousViewportTop?: number;
};

export interface NyanRunwayState {
  imageId?: number;
  cache?: Map<string, string>;
}

export interface RenderNyanRunwayOptions {
  /** Context usage percentage, 0-100. Undefined renders the cat at the start. */
  percent?: number | null;
  /** Reserved terminal-cell width for the whole runway. */
  cells: number;
  /** One-based terminal column where the runway starts, for in-line footer composition. */
  startColumn?: number;
  /** Optional persistent state. Use one state object per statusline. */
  state?: NyanRunwayState;
  /** Override the asset directory that contains nyan assets. */
  assetDir?: string;
  /** Minimum runway cells before rendering. Defaults to 8. */
  minimumCells?: number;
}

export interface NyanRunwayLayout {
  /** Reserved terminal-cell width for the whole runway. */
  cells: number;
  /** One-based terminal column where the runway starts. */
  startColumn: number;
  /** Context usage percentage, 0-100. Undefined targets the start. */
  percent?: number | null;
}

export interface NyanRunwayPainterOptions {
  /** Override the asset directory that contains nyan assets. */
  assetDir?: string;
  /** Minimum runway cells before rendering. Defaults to 8. */
  minimumCells?: number;
  /** Frame interval for bitmap animation. Defaults to 100ms. */
  frameIntervalMs?: number;
  /** How close to target progress before snapping. Defaults to 0.001. */
  progressSnap?: number;
  /** Fraction of remaining distance to move each frame. Defaults to 0.28. */
  progressEase?: number;
}

export interface NyanRunwayPainter {
  /** Update the target runway geometry/position. Call this from footer render(). */
  setTarget(layout: NyanRunwayLayout): void;
  /** Delete the visible Kitty image and stop animating. */
  clear(): void;
  /** Clear and permanently stop this painter. */
  dispose(): void;
  /** Short diagnostic string for /nyan debug. */
  debugInfo(): string;
}

export interface NyanDebugInfo {
  supported: boolean;
  imageProtocol: string | null;
  assetDir: string;
  assetsAvailable: boolean;
}
