const ANIMATION_FRAME_COUNT = 6;

export function remainingContextPercent(
  usedPercent: number | null | undefined,
): number | undefined {
  if (usedPercent === undefined || usedPercent === null || !Number.isFinite(usedPercent)) {
    return undefined;
  }
  return 100 - Math.min(100, Math.max(0, usedPercent));
}

export function normalizeAvailableProgress(usedPercent: number | null | undefined): number {
  return (remainingContextPercent(usedPercent) ?? 100) / 100;
}

export function animationFrame(frame: number): number {
  if (!Number.isFinite(frame) || frame <= 0) return 0;
  return ((Math.floor(frame) - 1) % ANIMATION_FRAME_COUNT) + 1;
}

export function progressPixelBucket(cells: number, progress: number): number {
  const widthPixels = Math.max(1, Math.floor(cells)) * 8;
  const boundedProgress = Math.min(1, Math.max(0, progress));
  return Math.round(boundedProgress * widthPixels);
}
