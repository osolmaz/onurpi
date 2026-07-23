const ANIMATION_FRAME_COUNT = 6;

export function normalizeAvailableProgress(usedPercent: number | null | undefined): number {
  if (usedPercent === undefined || usedPercent === null || Number.isNaN(usedPercent)) return 1;
  const normalizedUsed = Math.min(1, Math.max(0, usedPercent / 100));
  return 1 - normalizedUsed;
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
