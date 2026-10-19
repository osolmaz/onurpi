import type { BridgeLog, ChatTransport } from "./types.ts";

/** How often the status message may be edited. Discord allows about five edits per five seconds. */
export const PROGRESS_INTERVAL_MS = 5000;

/** The status message holds at most this many characters; Discord's own limit is 2000. */
export const MAX_STATUS_CHARS = 1700;

/** The status message shows at most this many notes, oldest first. */
export const MAX_STATUS_NOTES = 6;

export type ProgressEditorOptions = {
  readonly channelId: string;
  readonly intervalMs: number;
  readonly log: BridgeLog;
  /** The message the status message replies to, as the answer itself will. */
  readonly replyTo: string;
  readonly transport: ChatTransport;
};

/**
 * Posts one status message for a running answer and edits it as progress notes arrive, at most once
 * per interval. The first note posts the message, so a quick answer never posts one. `finish`
 * replaces the status message with the answer. Edits never throw: progress must not break an
 * answer.
 */
export class ProgressEditor {
  private chain: Promise<void> = Promise.resolve();
  private finished = false;
  private readonly lines: string[] = [];
  private lastEdit = 0;
  private messageId: string | undefined;
  private readonly unsent: string[] = [];
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private starting = false;

  constructor(private readonly options: ProgressEditorOptions) {}

  /** Whether a status message exists that `finish` can edit into the answer. */
  get posted(): boolean {
    return this.messageId !== undefined;
  }

  /** Whether a status message was posted or is being posted, so the answer must edit, not send. */
  get started(): boolean {
    return this.starting || this.messageId !== undefined;
  }

  /** Adds one note about what the agent is doing now. Notes after `finish` are ignored. */
  note(label: string): void {
    if (this.finished) return;
    this.lines.push(label);
    if (this.lines.length > MAX_STATUS_NOTES)
      this.lines.splice(0, this.lines.length - MAX_STATUS_NOTES);
    if (this.messageId === undefined) {
      this.unsent.push(label);
      if (!this.starting) {
        this.starting = true;
        void this.enqueue(() => this.post());
      }
      this.scheduleFlush();
      return;
    }
    this.unsent.push(label);
    if (Date.now() - this.lastEdit >= this.options.intervalMs) {
      void this.enqueue(() => this.flush()).catch(() => undefined);
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Replaces the status message with the answer. Resolves to true when the answer went into the
   * status message, and to false when there was none and the caller must send it. The chain runs
   * the edit after a post that is still in flight, so the answer is never posted twice.
   */
  finish(text: string): Promise<boolean> {
    this.finished = true;
    if (this.scheduled !== undefined) clearTimeout(this.scheduled);
    this.scheduled = undefined;
    return this.enqueue(async () => {
      const id = this.messageId;
      this.messageId = undefined;
      if (id === undefined) return false;
      await this.edit(id, text);
      return true;
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const tracked = this.chain.then(work, work);
    this.chain = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  /** Plans the one trailing edit that catches up when notes arrive faster than the interval. */
  private scheduleFlush(): void {
    if (this.scheduled !== undefined) return;
    const elapsed = Date.now() - this.lastEdit;
    this.scheduled = setTimeout(
      () => {
        this.scheduled = undefined;
        void this.enqueue(() => this.flush()).catch(() => undefined);
      },
      Math.max(0, this.options.intervalMs - elapsed),
    );
  }

  private async post(): Promise<void> {
    try {
      this.messageId = await this.options.transport.send(
        this.options.channelId,
        this.render(),
        this.options.replyTo,
      );
      this.lastEdit = Date.now();
      this.unsent.length = 0;
    } catch (error) {
      this.options.log("progress_failed", { error: String(error) });
    }
  }

  private async flush(): Promise<void> {
    const id = this.messageId;
    if (id === undefined || this.unsent.length === 0) return;
    this.unsent.length = 0;
    await this.edit(id, this.render());
  }

  private async edit(id: string, text: string): Promise<void> {
    try {
      await this.options.transport.edit?.(this.options.channelId, id, text);
      this.lastEdit = Date.now();
    } catch (error) {
      this.options.log("progress_failed", { error: String(error) });
    }
  }

  private render(): string {
    let lines = [...this.lines];
    let text = lines.join("\n");
    while (text.length > MAX_STATUS_CHARS && lines.length > 1) {
      lines = lines.slice(1);
      text = lines.join("\n");
    }
    return text.length > MAX_STATUS_CHARS ? `${text.slice(0, MAX_STATUS_CHARS - 1)}…` : text;
  }
}
