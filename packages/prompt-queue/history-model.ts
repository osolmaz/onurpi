const DEFAULT_LIMIT = 100;

/**
 * Session-scoped prompt history, newest first. Seeded from the session branch
 * on startup and appended on every editor submission.
 */
export class PromptHistory {
  private list: string[] = [];

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  get size(): number {
    return this.list.length;
  }

  entries(): readonly string[] {
    return this.list;
  }

  add(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.list[0] === trimmed) return;
    this.list.unshift(trimmed);
    if (this.list.length > this.limit) this.list.pop();
  }

  updateAt(index: number, text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || index < 0 || index >= this.list.length) return false;
    this.list[index] = trimmed;
    return true;
  }

  removeAt(index: number): boolean {
    if (index < 0 || index >= this.list.length) return false;
    this.list.splice(index, 1);
    return true;
  }

  reset(): void {
    this.list = [];
  }
}
