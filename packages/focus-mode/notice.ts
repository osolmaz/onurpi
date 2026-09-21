/**
 * Every user-visible string this package writes.
 *
 * Both the refusal and the stop message name focus mode, because the user asked for the reason to be
 * clear. The texts are exported constants and functions so the tests can pin them exactly.
 */

export const FOCUS_MODE_NAME = "focus mode";

export type FocusState = "held" | "ready" | "full";

export function rejectNotice(count: number, max: number, images = 0, restored = true): string {
  const head = `Focus mode: ${String(count)} of ${String(max)} agents are working, so this prompt was not sent.`;
  const tail = restored
    ? "Your text is back in the editor. Finish or stop another session, then press Enter again."
    : "Your text could not be put back in the editor.";
  if (images <= 0) return `${head} ${tail}`;
  const noun = images === 1 ? "image" : "images";
  return `${head} ${tail} ${String(images)} ${noun} could not be restored.`;
}

export function stopNotice(count: number, max: number): string {
  return (
    `Focus mode stopped this session: ${String(count)} agents were working and the cap is ` +
    `${String(max)}.`
  );
}

export function statusText(count: number, max: number, state: FocusState): string {
  const label = state === "held" ? "held" : state === "ready" ? "ready" : "full";
  return `focus ${String(count)}/${String(max)} · ${label}`;
}

export function configErrorNotice(errors: readonly string[]): string {
  return `Focus mode config: ${errors.join("; ")}`;
}

export function failureNotice(reason: string): string {
  return `Focus mode could not check the other sessions, so this prompt was allowed: ${reason}`;
}

export function listHeader(count: number, max: number): string {
  return `Focus mode: ${String(count)} of ${String(max)} agents working.`;
}

export function listEmpty(): string {
  return "Focus mode: no other session holds a lease.";
}

export function capChanged(max: number): string {
  return `Focus mode cap set to ${String(max)} for future sessions.`;
}
