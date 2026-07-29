import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Rgba, XpmImage } from "./types.ts";

export const DEFAULT_ASSET_DIR = join(import.meta.dirname, "..", "assets", "nyan-mode", "img");

const ASSET_NAMES = [
  "rainbow.xpm",
  "outerspace.xpm",
  "nyan.xpm",
  "nyan-frame-1.xpm",
  "nyan-frame-2.xpm",
  "nyan-frame-3.xpm",
  "nyan-frame-4.xpm",
  "nyan-frame-5.xpm",
  "nyan-frame-6.xpm",
] as const;
const XPM_CACHE_LIMIT = 64;
const xpmCache = new Map<string, XpmImage>();

export function assetsAvailable(assetDir: string): boolean {
  return ASSET_NAMES.every((name) => existsSync(join(assetDir, name)));
}

export function loadXpm(assetDir: string, name: string): XpmImage | undefined {
  const path = join(assetDir, name);
  const cached = xpmCache.get(path);
  if (cached) return cached;
  if (!existsSync(path)) return undefined;

  const image = parseXpm(readFileSync(path, "utf8"));
  if (xpmCache.size >= XPM_CACHE_LIMIT) {
    const first = xpmCache.keys().next().value;
    if (first !== undefined) xpmCache.delete(first);
  }
  xpmCache.set(path, image);
  return image;
}

export function parseXpm(source: string): XpmImage {
  const strings = source
    .split(/\r?\n/u)
    .map((line) => /^"([\s\S]*)",?$/u.exec(line.trim())?.[1])
    .filter((line): line is string => line !== undefined);
  const headerIndex = strings.findIndex(isXpmHeader);
  if (headerIndex === -1) throw new Error("invalid XPM: missing header");

  const header = parseHeader(strings[headerIndex] ?? "");
  const colors = parseColors(strings, headerIndex + 1, header.colorCount, header.charsPerPixel);
  const pixels = parsePixels(strings, headerIndex + 1 + header.colorCount, header, colors);
  return { width: header.width, height: header.height, pixels };
}

type XpmHeader = {
  width: number;
  height: number;
  colorCount: number;
  charsPerPixel: number;
};

function isXpmHeader(line: string): boolean {
  const parts = line.trim().split(/\s+/u);
  return parts.length >= 4 && parts.slice(0, 4).every((part) => /^\d+$/u.test(part));
}

function parseHeader(line: string): XpmHeader {
  const values = line
    .trim()
    .split(/\s+/u)
    .slice(0, 4)
    .map((value) => Number.parseInt(value, 10));
  const [width, height, colorCount, charsPerPixel] = values;
  if (
    width === undefined ||
    height === undefined ||
    colorCount === undefined ||
    charsPerPixel === undefined ||
    [width, height, colorCount, charsPerPixel].some((value) => value <= 0)
  ) {
    throw new Error("invalid XPM: invalid header");
  }
  return { width, height, colorCount, charsPerPixel };
}

function parseColors(
  lines: readonly string[],
  start: number,
  count: number,
  charsPerPixel: number,
): Map<string, Rgba> {
  const colors = new Map<string, Rgba>();
  for (let index = 0; index < count; index += 1) {
    const line = lines[start + index];
    if (line === undefined || line.length < charsPerPixel) {
      throw new Error("invalid XPM: missing color");
    }
    const key = line.slice(0, charsPerPixel);
    const value = /(?:^|\s)c\s+([^\s]+)/iu.exec(line.slice(charsPerPixel))?.[1] ?? "None";
    colors.set(key, parseXpmColor(value));
  }
  return colors;
}

function parsePixels(
  lines: readonly string[],
  start: number,
  header: XpmHeader,
  colors: ReadonlyMap<string, Rgba>,
): Buffer {
  const pixels = Buffer.alloc(header.width * header.height * 4);
  for (let y = 0; y < header.height; y += 1) {
    const row = lines[start + y];
    if (row === undefined || row.length < header.width * header.charsPerPixel) {
      throw new Error("invalid XPM: missing pixel row");
    }
    for (let x = 0; x < header.width; x += 1) {
      writeColor(pixels, (y * header.width + x) * 4, colorAt(row, x, header, colors));
    }
  }
  return pixels;
}

function colorAt(
  row: string,
  x: number,
  header: XpmHeader,
  colors: ReadonlyMap<string, Rgba>,
): Rgba {
  const key = row.slice(x * header.charsPerPixel, (x + 1) * header.charsPerPixel);
  return colors.get(key) ?? [0, 0, 0, 0];
}

function writeColor(target: Buffer, offset: number, color: Rgba): void {
  target.writeUInt8(color[0], offset);
  target.writeUInt8(color[1], offset + 1);
  target.writeUInt8(color[2], offset + 2);
  target.writeUInt8(color[3], offset + 3);
}

function parseXpmColor(value: string): Rgba {
  if (/^none$/iu.test(value)) return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{6})$/iu.exec(value)?.[1];
  if (hex) return parseHexColor(hex);
  if (/^black$/iu.test(value)) return [0, 0, 0, 255];
  if (/^white$/iu.test(value)) return [255, 255, 255, 255];

  const gray = /^gr[ae]y(\d+)$/iu.exec(value)?.[1];
  if (!gray) return [255, 0, 255, 255];
  const channel = Math.max(0, Math.min(255, Math.round((Number.parseInt(gray, 10) / 100) * 255)));
  return [channel, channel, channel, 255];
}

function parseHexColor(value: string): Rgba {
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ];
}
