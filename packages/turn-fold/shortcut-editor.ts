import {
  type AppKeybinding,
  CustomEditor,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  isFocusable,
  matchesKey,
  type AutocompleteProvider,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

const TOGGLE_COMMAND = "/turn-fold toggle";
const TOGGLE_SHORTCUT = "ctrl+shift+o";

type ShortcutCallbacks = {
  cancel: (error?: unknown) => void;
  request: () => boolean;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return typeof Reflect.get(value, "then") === "function";
}

export function enableTranscriptShrinkClearing(
  tui: Pick<TUI, "getClearOnShrink" | "setClearOnShrink">,
): () => void {
  if (tui.getClearOnShrink()) return () => undefined;
  tui.setClearOnShrink(true);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    tui.setClearOnShrink(false);
  };
}

export class ToggleShortcutController {
  private pending = false;

  request(idle: boolean, notify: (message: string, level: "info") => void): boolean {
    if (this.pending) {
      notify("Turn Fold toggle already queued.", "info");
      return false;
    }
    this.pending = true;
    if (!idle) notify("Turn Fold toggle queued until the current response finishes.", "info");
    return true;
  }

  cancel(): void {
    this.pending = false;
  }

  async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } finally {
      this.pending = false;
    }
  }
}

export class TurnFoldShortcutEditor implements EditorComponent {
  readonly actionHandlers = new Map<AppKeybinding, () => void>();
  readonly base: EditorComponent;
  onCtrlD?: () => void;
  onEscape?: () => void;
  onExtensionShortcut?: (data: string) => boolean;
  onPasteImage?: () => void;
  private readonly callbacks: ShortcutCallbacks;
  private changeHandler: ((text: string) => void) | undefined;
  private shortcutSubmission = false;
  private submitHandler: ((text: string) => unknown) | undefined;

  constructor(base: EditorComponent, callbacks: ShortcutCallbacks) {
    this.base = base;
    this.callbacks = callbacks;
    this.changeHandler = base.onChange;
    this.submitHandler = base.onSubmit;
    base.onChange = (text) => {
      this.changeHandler?.(text);
    };
    base.onSubmit = (text) => {
      this.submitHandler?.(text);
    };
  }

  get focused(): boolean {
    return isFocusable(this.base) && this.base.focused;
  }

  set focused(value: boolean) {
    if (isFocusable(this.base)) this.base.focused = value;
  }

  get wantsKeyRelease(): boolean {
    return this.base.wantsKeyRelease ?? false;
  }

  get onSubmit(): (text: string) => void {
    return (text) => {
      this.submitHandler?.(text);
    };
  }

  set onSubmit(handler: (text: string) => void) {
    this.submitHandler = handler;
  }

  get onChange(): (text: string) => void {
    return (text) => {
      this.changeHandler?.(text);
    };
  }

  set onChange(handler: (text: string) => void) {
    this.changeHandler = handler;
  }

  get borderColor(): (text: string) => string {
    return this.base.borderColor ?? ((text) => text);
  }

  set borderColor(handler: (text: string) => string) {
    this.base.borderColor = handler;
  }

  render(width: number): string[] {
    return this.base.render(width);
  }

  invalidate(): void {
    this.base.invalidate();
  }

  handleInput(data: string): void {
    this.syncActionHandlers();
    if (!matchesKey(data, TOGGLE_SHORTCUT)) {
      this.base.handleInput(data);
      return;
    }
    if (!this.callbacks.request()) return;
    const submit = this.submitHandler;
    if (!submit) {
      this.callbacks.cancel();
      return;
    }
    this.shortcutSubmission = true;
    try {
      const result = submit(TOGGLE_COMMAND);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error: unknown) => {
          this.callbacks.cancel(error);
        });
      }
    } catch (error) {
      this.callbacks.cancel(error);
      throw error;
    } finally {
      this.shortcutSubmission = false;
    }
  }

  getText(): string {
    return this.base.getText();
  }

  setText(text: string): void {
    if (this.shortcutSubmission && text === "") return;
    this.base.setText(text);
  }

  addToHistory(text: string): void {
    this.base.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    this.base.insertTextAtCursor?.(text);
  }

  getExpandedText(): string {
    return this.base.getExpandedText?.() ?? this.base.getText();
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.base.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.base.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.base.setAutocompleteMaxVisible?.(maxVisible);
  }

  private syncActionHandlers(): void {
    const baseHandlers: unknown = Reflect.get(this.base, "actionHandlers");
    if (baseHandlers instanceof Map) {
      baseHandlers.clear();
      for (const [action, handler] of this.actionHandlers) baseHandlers.set(action, handler);
    }
    if (this.onCtrlD) Reflect.set(this.base, "onCtrlD", this.onCtrlD);
    if (this.onEscape) Reflect.set(this.base, "onEscape", this.onEscape);
    if (this.onExtensionShortcut) {
      Reflect.set(this.base, "onExtensionShortcut", this.onExtensionShortcut);
    }
    if (this.onPasteImage) Reflect.set(this.base, "onPasteImage", this.onPasteImage);
  }
}

export function installTurnFoldShortcutEditor(
  ctx: ExtensionContext,
  callbacks: ShortcutCallbacks,
): () => void {
  const previous = ctx.ui.getEditorComponent();
  const shrinkRestorers = new Map<TUI, () => void>();
  const factory = (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ): EditorComponent => {
    if (!shrinkRestorers.has(tui)) {
      shrinkRestorers.set(tui, enableTranscriptShrinkClearing(tui));
    }
    const base = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
    return new TurnFoldShortcutEditor(base, callbacks);
  };
  ctx.ui.setEditorComponent(factory);
  return () => {
    if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(previous);
    for (const restore of shrinkRestorers.values()) restore();
    shrinkRestorers.clear();
  };
}
