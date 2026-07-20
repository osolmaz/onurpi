const ANIMATION_FRAME_COUNT = 6;

export function normalizeProgress(percent: number | null | undefined): number {
  if (percent === undefined || percent === null || Number.isNaN(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
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
