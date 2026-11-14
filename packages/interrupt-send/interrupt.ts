import { takeNextQueuedMessage, type QueuedSession } from "./queue.ts";

export const NOTHING_TO_SEND = "Nothing to send";

export type InterruptEditor = {
  getExpandedText?(): string;
  getText(): string;
  setText(text: string): void;
};

export type InterruptSession = QueuedSession & {
  abort(): Promise<void>;
  readonly isCompacting: boolean;
  readonly isStreaming: boolean;
};

export type InterruptTarget = {
  readonly editor: InterruptEditor;
  readonly session: InterruptSession;
  showStatus(message: string): void;
  submit(text: string): void;
};

function typedText(editor: InterruptEditor): string | undefined {
  const expanded = editor.getExpandedText;
  const raw = typeof expanded === "function" ? expanded.call(editor) : editor.getText();
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Send now: interrupt the running turn, then submit the typed text or the oldest queued message.
 *
 * With text in the editor that text wins. With an empty editor the oldest queued message is taken
 * out of the queue, so repeated presses drain the queue one message at a time.
 */
export async function runInterruptSend(target: InterruptTarget): Promise<void> {
  const typed = typedText(target.editor);
  const outgoing = typed ?? takeNextQueuedMessage(target.session);
  if (outgoing === undefined) {
    target.showStatus(NOTHING_TO_SEND);
    return;
  }
  if (typed !== undefined) target.editor.setText("");
  if (target.session.isStreaming || target.session.isCompacting) await target.session.abort();
  target.submit(outgoing);
}
