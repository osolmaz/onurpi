export type Rgba = readonly [number, number, number, number];

export type XpmImage = {
  width: number;
  height: number;
  pixels: Buffer;
};

export type RenderNyanRunwayOptions = {
  percent?: number | null;
  cells: number;
  startColumn?: number;
  minimumCells?: number;
};

export type NyanRunwayLayout = {
  cells: number;
  startColumn: number;
  percent?: number | null;
};

export type NyanRunwayPainterOptions = {
  assetDir?: string;
  minimumCells?: number;
  frameIntervalMs?: number;
  progressSnap?: number;
  progressEase?: number;
};

export type NyanRunwayPainter = {
  render(layout: NyanRunwayLayout): string | undefined;
  clear(): void;
  dispose(): void;
  debugInfo(): string;
};

export type NyanDebugInfo = {
  supported: boolean;
  imageProtocol: string | null;
  assetDir: string;
  assetsAvailable: boolean;
};
