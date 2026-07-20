import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import type { QueueItemMode } from "./queue-model.ts";
import { decideForcedEnqueue, decideSubmit, shouldOpenManagerOnUp } from "./submit-policy.ts";

export type QueueEditorHooks = {
  /** True while the agent is running (streaming, retrying, or continuing). */
  isBusy(): boolean;
  /** Capture a submitted prompt into the extension queue. */
  enqueue(text: string, mode: QueueItemMode): void;
  /** Open the queue/history manager window. */
  openManager(): void;
  /** Record a submission in the extension prompt history. */
  recordHistory(text: string): void;
  /** A prompt went through Pi's own submission path. */
  onDirectSubmit(): void;
};

/**
 * Prompt editor that reroutes submissions while the agent is busy:
 * enter captures a queued follow-up, tab captures a steering message, and
 * up (on an empty editor) or alt+up opens the queue manager. Slash and bash
 * commands always fall through to Pi's built-in handling.
 */
export class QueuePromptEditor extends CustomEditor {
  private readonly hooks: QueueEditorHooks;
  private readonly bindings: KeybindingsManager;
  private innerSubmit: ((text: string) => void) | undefined;
  private wrappedSubmit: ((text: string) => void) | undefined;
  private forcedMode: QueueItemMode | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    hooks: QueueEditorHooks,
  ) {
    super(tui, theme, keybindings);
    this.bindings = keybindings;
    this.hooks = hooks;
  }

  override handleInput(data: string): void {
    this.ensureSubmitWrapper();
    if (this.interceptKey(data)) return;
    super.handleInput(data);
  }

  private interceptKey(data: string): boolean {
    if (this.bindings.matches(data, "app.message.dequeue")) {
      this.hooks.openManager();
      return true;
    }
    if (
      this.bindings.matches(data, "tui.editor.cursorUp") &&
      !this.isShowingAutocomplete() &&
      shouldOpenManagerOnUp(this.getText())
    ) {
      this.hooks.openManager();
      return true;
    }
    if (this.bindings.matches(data, "tui.input.tab")) return this.submitForced("steer");
    if (this.bindings.matches(data, "app.message.followUp")) return this.submitForced("queue");
    return false;
  }

  /**
   * Route tab / alt+enter through the editor's own submit machinery so
   * paste markers, undo state, and inline history behave exactly like a
   * normal enter submission.
   */
  private submitForced(mode: QueueItemMode): boolean {
    const decision = decideForcedEnqueue(
      this.getText(),
      this.hooks.isBusy(),
      this.isShowingAutocomplete(),
    );
    if (decision !== "enqueue") return false;
    this.forcedMode = mode;
    try {
      super.handleInput("\r");
    } finally {
      this.forcedMode = undefined;
    }
    return true;
  }

  /**
   * Interactive mode assigns `onSubmit` after constructing the editor, so
   * the wrapper is (re)installed lazily on every keystroke.
   */
  private ensureSubmitWrapper(): void {
    const current = this.onSubmit;
    if (current !== undefined && current === this.wrappedSubmit) return;
    this.innerSubmit = current;
    this.wrappedSubmit = (text: string) => {
      this.dispatchSubmit(text);
    };
    this.onSubmit = this.wrappedSubmit;
  }

  private dispatchSubmit(text: string): void {
    const forced = this.forcedMode;
    this.forcedMode = undefined;
    const decision = decideSubmit(text, this.hooks.isBusy());
    if (decision === "ignore") return;
    if (decision === "directive") {
      // Slash and bash commands are not prompts: they stay out of the
      // prompt history and must not resume held delivery.
      this.innerSubmit?.(text);
      return;
    }
    this.hooks.recordHistory(text);
    if (forced !== undefined || decision === "enqueue") {
      this.addToHistory(text);
      this.hooks.enqueue(text, forced ?? "queue");
      return;
    }
    this.hooks.onDirectSubmit();
    this.innerSubmit?.(text);
  }
}
