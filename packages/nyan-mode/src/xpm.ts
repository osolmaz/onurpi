import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rgba, XpmImage } from "./types";

export const DEFAULT_ASSET_DIR = join(__dirname, "..", "assets", "nyan-mode", "img");

const xpmCache = new Map<string, XpmImage>();

export function assetsAvailable(assetDir: string): boolean {
  return [
    "rainbow.xpm",
    "outerspace.xpm",
    "nyan.xpm",
    "nyan-frame-1.xpm",
    "nyan-frame-2.xpm",
    "nyan-frame-3.xpm",
    "nyan-frame-4.xpm",
    "nyan-frame-5.xpm",
    "nyan-frame-6.xpm",
  ].every((name) => existsSync(join(assetDir, name)));
}

export function loadXpm(assetDir: string, name: string) {
  const cacheKey = `${assetDir}/${name}`;
  const cached = xpmCache.get(cacheKey);
  if (cached) return cached;

  const path = join(assetDir, name);
  if (!existsSync(path)) return undefined;

  const image = parseXpm(readFileSync(path, "utf8"));
  xpmCache.set(cacheKey, image);
  return image;
}

function parseXpm(source: string): XpmImage {
  const strings = source
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^"([\s\S]*)",?$/)?.[1])
    .filter((line): line is string => line !== undefined);

  const headerIndex = strings.findIndex((line) => {
    const parts = line.trim().split(/\s+/);
    return parts.length >= 4 && parts.slice(0, 4).every((part) => /^\d+$/.test(part));
  });
  if (headerIndex === -1) throw new Error("invalid XPM: missing header");

  const [width, height, colorCount, charsPerPixel] = strings[headerIndex]
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((value) => Number.parseInt(value, 10));
  const colors = new Map<string, Rgba>();

  for (let i = 0; i < colorCount; i++) {
    const line = strings[headerIndex + 1 + i];
    const key = line.slice(0, charsPerPixel);
    const color = line.slice(charsPerPixel).match(/(?:^|\s)c\s+([^\s]+)/i)?.[1] ?? "None";
    colors.set(key, parseXpmColor(color));
  }

  const pixels = Buffer.alloc(width * height * 4, 0);
  const firstPixelLine = headerIndex + 1 + colorCount;
  for (let y = 0; y < height; y++) {
    const row = strings[firstPixelLine + y] ?? "";
    for (let x = 0; x < width; x++) {
      const key = row.slice(x * charsPerPixel, (x + 1) * charsPerPixel);
      const color = colors.get(key) ?? [0, 0, 0, 0];
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }

  return { width, height, pixels };
}

function parseXpmColor(value: string): Rgba {
  if (/^none$/i.test(value)) return [0, 0, 0, 0];

  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }

  if (/^black$/i.test(value)) return [0, 0, 0, 255];
  if (/^white$/i.test(value)) return [255, 255, 255, 255];

  const gray = value.match(/^gr[ae]y(\d+)$/i)?.[1];
  if (gray) {
    const channel = Math.max(0, Math.min(255, Math.round((Number.parseInt(gray, 10) / 100) * 255)));
    return [channel, channel, channel, 255];
  }

  return [255, 0, 255, 255];
}
