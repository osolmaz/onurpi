import { encodePngRgba } from "./png.ts";
import { animationFrame, progressPixelBucket } from "./progress.ts";
import type { XpmImage } from "./types.ts";
import { loadXpm } from "./xpm.ts";

const MINIMUM_CELLS = 8;
const PNG_CACHE_LIMIT = 240;

export function getCachedNyanPng(
  cache: Map<string, string>,
  assetDir: string,
  widthCells: number,
  progress: number,
  frame: number,
): string | undefined {
  const cells = Math.max(MINIMUM_CELLS, Math.floor(widthCells));
  const pixelBucket = progressPixelBucket(cells, progress);
  const cacheKey = [assetDir, cells, pixelBucket, frame].map(String).join(":");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const base64 = makeNyanPng(assetDir, cells, pixelBucket / (cells * 8), frame);
  if (!base64) return undefined;
  discardOldest(cache);
  cache.set(cacheKey, base64);
  return base64;
}

function discardOldest(cache: Map<string, string>): void {
  if (cache.size < PNG_CACHE_LIMIT) return;
  const first = cache.keys().next().value;
  if (first !== undefined) cache.delete(first);
}

function makeNyanPng(
  assetDir: string,
  widthCells: number,
  progress: number,
  frame: number,
): string | undefined {
  const rainbow = loadXpm(assetDir, "rainbow.xpm");
  const outerspace = loadXpm(assetDir, "outerspace.xpm");
  const cat = loadCat(assetDir, frame);
  if (!rainbow || !outerspace || !cat) return undefined;

  const width = Math.max(cat.width, Math.floor(widthCells) * rainbow.width);
  const height = Math.max(rainbow.height, cat.height, outerspace.height);
  const pixels = Buffer.alloc(width * height * 4);
  const catX = Math.round(Math.max(0, width - cat.width) * Math.min(1, Math.max(0, progress)));
  tileBackground(pixels, width, height, outerspace);
  tileRainbow(pixels, width, height, rainbow, catX);
  blit(pixels, width, height, cat, catX, 0);
  return encodePngRgba(width, height, pixels);
}

function loadCat(assetDir: string, frame: number): XpmImage | undefined {
  const frameNumber = animationFrame(frame);
  const animated =
    frameNumber > 0 ? loadXpm(assetDir, `nyan-frame-${String(frameNumber)}.xpm`) : undefined;
  return animated ?? loadXpm(assetDir, "nyan.xpm");
}

function tileBackground(
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
  background: XpmImage,
): void {
  for (let x = 0; x < targetWidth; x += background.width) {
    blit(target, targetWidth, targetHeight, background, x, 0);
  }
}

function tileRainbow(
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
  rainbow: XpmImage,
  catX: number,
): void {
  for (let x = 0; x < catX; x += rainbow.width) {
    blit(target, targetWidth, targetHeight, rainbow, x, 0, catX);
  }
}

function blit(
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
  source: XpmImage,
  x: number,
  y: number,
  maximumX = targetWidth,
): void {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const targetY = y + sourceY;
    if (targetY < 0 || targetY >= targetHeight) continue;
    copyRow(target, targetWidth, source, sourceY, x, targetY, maximumX);
  }
}

function copyRow(
  target: Buffer,
  targetWidth: number,
  source: XpmImage,
  sourceY: number,
  x: number,
  targetY: number,
  maximumX: number,
): void {
  for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
    const targetX = x + sourceX;
    if (targetX < 0 || targetX >= targetWidth || targetX >= maximumX) continue;
    copyPixel(target, targetWidth, source, sourceX, sourceY, targetX, targetY);
  }
}

function copyPixel(
  target: Buffer,
  targetWidth: number,
  source: XpmImage,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): void {
  const sourceOffset = (sourceY * source.width + sourceX) * 4;
  const alpha = source.pixels.readUInt8(sourceOffset + 3);
  if (alpha === 0) return;
  const targetOffset = (targetY * targetWidth + targetX) * 4;
  source.pixels.copy(target, targetOffset, sourceOffset, sourceOffset + 3);
  target.writeUInt8(alpha, targetOffset + 3);
}
