/**
 * Bounded hash-keyed cache for ejected image payloads.
 *
 * The cache lives in process memory only. Nothing here writes to disk, so a resumed, reloaded, or
 * crashed session has an empty cache and its live markers have no picture until a tool reads the
 * source path again.
 *
 * Eviction is oldest-first and the byte total never exceeds the limit. An image larger than the
 * whole limit is therefore not kept at all.
 */

export type CachedImage = {
  /** Base64 payload. */
  data: string;
  mimeType: string;
};

export class ImageCache {
  private readonly entries = new Map<string, CachedImage>();
  private total = 0;
  private limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get bytes(): number {
    return this.total;
  }

  get count(): number {
    return this.entries.size;
  }

  get maxBytes(): number {
    return this.limit;
  }

  /** Hashes in insertion order, oldest first. */
  hashes(): string[] {
    return [...this.entries.keys()];
  }

  has(hash: string): boolean {
    return this.entries.has(hash);
  }

  get(hash: string): CachedImage | undefined {
    return this.entries.get(hash);
  }

  /** Identical payloads share one entry, so a repeat does not change the eviction order. */
  set(hash: string, image: CachedImage): void {
    if (this.entries.has(hash)) return;
    this.entries.set(hash, image);
    this.total += image.data.length;
    this.evict();
  }

  /** Drop every entry whose hash is not live. Returns the number of dropped entries. */
  retain(live: ReadonlySet<string>): number {
    let dropped = 0;
    for (const [hash, image] of this.entries) {
      if (live.has(hash)) continue;
      this.entries.delete(hash);
      this.total -= image.data.length;
      dropped += 1;
    }
    return dropped;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  setLimit(limit: number): void {
    this.limit = limit;
    this.evict();
  }

  private evict(): void {
    for (const [hash, image] of this.entries) {
      if (this.total <= this.limit) return;
      this.entries.delete(hash);
      this.total -= image.data.length;
    }
  }
}
