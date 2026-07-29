import type { XpmImage } from "./types";
import { encodePngRgba } from "./png";
import { loadXpm } from "./xpm";

export function normalizeProgress(percent: number | null | undefined): number {
  if (percent === undefined || percent === null || Number.isNaN(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
}

export function getCachedNyanPng(
  cache: Map<string, string>,
  assetDir: string,
  widthCells: number,
  progress: number,
  frame: number,
) {
  const cells = Math.max(8, Math.floor(widthCells));
  const pixelBucket = Math.round(Math.min(1, Math.max(0, progress)) * cells * 8);
  const cacheKey = `${assetDir}:${cells}:${pixelBucket}:${frame}`;

  let base64 = cache.get(cacheKey);
  if (!base64) {
    base64 = makeNyanPng(assetDir, cells, pixelBucket / (cells * 8), frame);
    if (!base64) return undefined;
    if (cache.size > 240) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(cacheKey, base64);
  }
  return base64;
}

function makeNyanPng(assetDir: string, widthCells: number, progress: number, frame: number) {
  const rainbow = loadXpm(assetDir, "rainbow.xpm");
  const outerspace = loadXpm(assetDir, "outerspace.xpm");
  const frameNumber = frame > 0 ? ((frame - 1) % 6) + 1 : 0;
  const cat = loadXpm(assetDir, frameNumber > 0 ? `nyan-frame-${frameNumber}.xpm` : "nyan.xpm") ?? loadXpm(assetDir, "nyan.xpm");
  if (!rainbow || !outerspace || !cat) return undefined;

  const width = Math.max(cat.width, Math.floor(widthCells) * rainbow.width);
  const height = Math.max(rainbow.height, cat.height, outerspace.height);
  const pixels = Buffer.alloc(width * height * 4, 0);
  const catX = Math.round(Math.max(0, width - cat.width) * Math.min(1, Math.max(0, progress)));

  for (let x = 0; x < width; x += outerspace.width) {
    blit(pixels, width, height, outerspace, x, 0);
  }
  for (let x = 0; x < catX; x += rainbow.width) {
    blitUntilX(pixels, width, height, rainbow, x, 0, catX);
  }
  blit(pixels, width, height, cat, catX, 0);

  return encodePngRgba(width, height, pixels);
}

function blit(target: Buffer, targetWidth: number, targetHeight: number, source: XpmImage, x: number, y: number) {
  for (let yy = 0; yy < source.height; yy++) {
    const targetY = y + yy;
    if (targetY < 0 || targetY >= targetHeight) continue;

    for (let xx = 0; xx < source.width; xx++) {
      const targetX = x + xx;
      if (targetX < 0 || targetX >= targetWidth) continue;

      copyPixel(target, targetWidth, source, xx, yy, targetX, targetY);
    }
  }
}

function blitUntilX(
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
  source: XpmImage,
  x: number,
  y: number,
  maxX: number,
) {
  for (let yy = 0; yy < source.height; yy++) {
    const targetY = y + yy;
    if (targetY < 0 || targetY >= targetHeight) continue;

    for (let xx = 0; xx < source.width; xx++) {
      const targetX = x + xx;
      if (targetX < 0 || targetX >= targetWidth || targetX >= maxX) continue;

      copyPixel(target, targetWidth, source, xx, yy, targetX, targetY);
    }
  }
}

function copyPixel(target: Buffer, targetWidth: number, source: XpmImage, sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const sourceOffset = (sourceY * source.width + sourceX) * 4;
  const alpha = source.pixels[sourceOffset + 3];
  if (alpha === 0) return;

  const targetOffset = (targetY * targetWidth + targetX) * 4;
  target[targetOffset] = source.pixels[sourceOffset];
  target[targetOffset + 1] = source.pixels[sourceOffset + 1];
  target[targetOffset + 2] = source.pixels[sourceOffset + 2];
  target[targetOffset + 3] = alpha;
}
