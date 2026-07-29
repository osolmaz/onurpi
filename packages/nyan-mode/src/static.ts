import { allocateImageId, getCapabilities, renderImage } from "@earendil-works/pi-tui";
import { getCachedNyanPng, normalizeProgress } from "./image";
import type { NyanDebugInfo, NyanRunwayState, RenderNyanRunwayOptions } from "./types";
import { assetsAvailable, DEFAULT_ASSET_DIR } from "./xpm";

const DEFAULT_STATE: NyanRunwayState = {};

/** Legacy static renderer. Prefer createNyanRunwayPainter() for smooth animation. */
export function renderNyanRunway(options: RenderNyanRunwayOptions): string | undefined {
  if (getCapabilities().images !== "kitty") return undefined;

  const cells = Math.floor(options.cells);
  const minimumCells = options.minimumCells ?? 8;
  if (cells < minimumCells) return undefined;

  const state = options.state ?? DEFAULT_STATE;
  const assetDir = options.assetDir ?? DEFAULT_ASSET_DIR;
  const progress = normalizeProgress(options.percent);
  const base64 = getCachedNyanPng(state.cache ?? (state.cache = new Map()), assetDir, cells, progress, 0);
  if (!base64) return undefined;

  if (state.imageId === undefined) state.imageId = allocateImageId();
  const result = renderImage(base64, { widthPx: cells * 8, heightPx: 15 }, {
    maxWidthCells: cells,
    imageId: state.imageId,
    moveCursor: false,
  });

  if (!result || result.rows !== 1) return undefined;
  if (result.imageId) state.imageId = result.imageId;

  if (options.startColumn === undefined) return result.sequence + " ".repeat(cells);
  return " ".repeat(cells) + `\x1b[${options.startColumn}G` + result.sequence + `\x1b[${options.startColumn + cells}G`;
}

/** True when the current terminal can render bitmap Nyan in a one-line statusline. */
export function supportsNyanRunway(): boolean {
  return getCapabilities().images === "kitty";
}

/** Small diagnostic payload for /nyan debug commands. */
export function getNyanDebugInfo(assetDir = DEFAULT_ASSET_DIR): NyanDebugInfo {
  const protocol = getCapabilities().images;
  return {
    supported: protocol === "kitty",
    imageProtocol: protocol,
    assetDir,
    assetsAvailable: assetsAvailable(assetDir),
  };
}

export function getDefaultNyanAssetDir(): string {
  return DEFAULT_ASSET_DIR;
}
