import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

/**
 * Ignore an allow key that arrives right after the dialog opens or right after the previous key, so
 * a message the user is still typing cannot approve a call.
 */
export const TYPED_AHEAD_GUARD_MS = 350;

export type DialogKeyAction = "allow" | "deny" | "ignore";

/**
 * Map one input byte to a dialog action, given the time since the last key. Only the letter keys
 * act: Enter, a space, or a stray character does nothing. A deny always counts.
 */
export function decideFromKey(
  data: string,
  quietMs: number,
  guardMs: number = TYPED_AHEAD_GUARD_MS,
): DialogKeyAction {
  if (data === "n" || data === "N") return "deny";
  if (data !== "y" && data !== "Y") return "ignore";
  return quietMs >= guardMs ? "allow" : "ignore";
}

/** Text styling, passed in so this module does not depend on Pi's theme types. */
export type DialogText = {
  title(text: string): string;
  body(text: string): string;
  hint(text: string): string;
};

export type ApprovalDialogOptions = {
  summary: string;
  text: DialogText;
  matchesCancel(data: string): boolean;
  now(): number;
  openedAt: number;
  done(approved: boolean): void;
};

export const DIALOG_TITLE = "Allow this call?";
export const DIALOG_HINT = "y allow once - n or escape deny";

/**
 * Build the approval dialog. It shows the whole call description, wrapped to the terminal width,
 * and it finishes through the callback Pi supplied.
 */
export function createApprovalComponent(options: ApprovalDialogOptions): Component {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  let lastInputAt = options.openedAt;

  const invalidate = (): void => {
    cachedWidth = undefined;
    cachedLines = undefined;
  };

  return {
    invalidate,
    render(width: number): string[] {
      if (cachedLines !== undefined && cachedWidth === width) return cachedLines;
      cachedWidth = width;
      cachedLines = [
        options.text.title(DIALOG_TITLE),
        ...wrapTextWithAnsi(options.text.body(options.summary), width),
        options.text.hint(DIALOG_HINT),
      ].map((line) => truncateToWidth(line, width));
      return cachedLines;
    },
    handleInput(data: string): void {
      const quietMs = options.now() - lastInputAt;
      lastInputAt = options.now();
      if (options.matchesCancel(data)) {
        options.done(false);
        return;
      }
      const action = decideFromKey(data, quietMs);
      if (action === "allow") options.done(true);
      if (action === "deny") options.done(false);
    },
  };
}
