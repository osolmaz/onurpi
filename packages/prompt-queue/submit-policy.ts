export type SubmitDecision = "ignore" | "pass" | "enqueue";

/**
 * Slash commands and bash directives must go through Pi's own submission
 * path: extension commands cannot be queued, and templates or skills are
 * only expanded there.
 */
function isDirective(text: string): boolean {
  return text.startsWith("/") || text.startsWith("!");
}

/**
 * Decide what happens when the user presses enter in the prompt editor.
 * Plain prompts are captured into the extension queue while the agent is
 * busy; everything else follows Pi's built-in behavior.
 */
export function decideSubmit(text: string, busy: boolean): SubmitDecision {
  const trimmed = text.trim();
  if (!trimmed) return "ignore";
  if (!busy || isDirective(trimmed)) return "pass";
  return "enqueue";
}

/**
 * Decide whether an explicit queue keypress (tab for steer, alt+enter for
 * follow-up) should capture the editor content.
 */
export function decideForcedEnqueue(
  text: string,
  busy: boolean,
  autocompleteOpen: boolean,
): "enqueue" | "default" {
  const trimmed = text.trim();
  if (!busy || autocompleteOpen || !trimmed || isDirective(trimmed)) return "default";
  return "enqueue";
}

/** Up opens the queue/history manager only when the editor is empty. */
export function shouldOpenManagerOnUp(text: string): boolean {
  return text.trim().length === 0;
}
