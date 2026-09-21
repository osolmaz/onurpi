/**
 * Put a refused prompt back into the editor.
 *
 * Measurement at Pi 0.86.1: `submitValue()` in `pi-tui/dist/components/editor.js` resets the editor
 * and clears its paste markers *before* it hands the text to the submit handler, and
 * `prompt()` in `pi-coding-agent/dist/core/agent-session.js` returns early on a `handled` result
 * without ever writing the editor. So the editor is empty when the refusal happens and this module
 * must restore the text itself.
 *
 * The same measurement explains the image case: the editor drops its paste markers, and the
 * documented UI surface cannot read or write editor images. A refusal therefore reports the count
 * instead of pretending the images survived.
 */

export type EditorSurface = {
  getEditorText(): string;
  setEditorText(text: string): void;
};

export type PreserveResult = {
  /** True when the editor holds the refused text after this call. */
  restored: boolean;
  /** How many attached images the editor could not keep. */
  images: number;
};

export function preserveRejectedPrompt(
  ui: EditorSurface,
  text: string,
  images: readonly unknown[] = [],
): PreserveResult {
  const imageCount = images.length;
  if (text.length === 0) return { restored: false, images: imageCount };
  const current = ui.getEditorText();
  if (current === text) return { restored: true, images: imageCount };
  // The editor is normally empty here. Never overwrite text the user already started writing.
  if (current.length > 0) return { restored: false, images: imageCount };
  ui.setEditorText(text);
  return { restored: true, images: imageCount };
}
