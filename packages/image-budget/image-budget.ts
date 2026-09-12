/**
 * Pure image byte policy for Pi sessions.
 *
 * Pi bounds text tool output, but nothing bounds image payloads. Every screenshot a tool returns
 * stays in the retained context and is resent on every request, so a vision-heavy session can grow
 * past a provider's request-body limit. The Hugging Face router, for example, rejects any request
 * body over 5 MiB with `413 request entity too large`, and that rejection happens before the model
 * runs, so the whole conversation dies.
 *
 * These functions decide what to keep, shrink, and redact. They never touch Pi state directly.
 */

export type ImageBudgetConfig = {
  /** Master switch. When false, the extension is inert. */
  enabled: boolean;
  /** Base64 budget for one image returned by a tool. Larger images are re-encoded. */
  maxImageBytes: number;
  /** Maximum width for re-encoded tool images. */
  maxImageWidth: number;
  /** Maximum height for re-encoded tool images. */
  maxImageHeight: number;
  /** Images kept per tool result. Extra images become a text note. */
  maxImagesPerResult: number;
  /** Base64 image budget for one provider request. Crossing it redacts old images. */
  imageBudgetBytes: number;
  /** Target image bytes after a redaction pass. Keeps redaction from running every turn. */
  redactToBytes: number;
  /** Send a UI notification when images are resized or redacted. */
  notify: boolean;
  /** Show current image bytes in the footer status area. */
  status: boolean;
};

export const DEFAULT_CONFIG: ImageBudgetConfig = {
  enabled: true,
  maxImageBytes: 400 * 1024,
  maxImageWidth: 1600,
  maxImageHeight: 1600,
  maxImagesPerResult: 4,
  imageBudgetBytes: 3.5 * 1024 * 1024,
  redactToBytes: 2.5 * 1024 * 1024,
  notify: true,
  status: true,
};

export type ImageRef = {
  bytes: number;
  mimeType: string;
  toolName?: string | undefined;
};

export type RedactionSummary = {
  redactCount: number;
  bytesBefore: number;
  bytesAfter: number;
};

export type RedactionPlan = {
  /** Number of oldest images to redact. */
  redactCount: number;
  bytesBefore: number;
  bytesAfter: number;
  redactedBytes: number;
};

export type ResultOutcome = {
  omitted: number;
  resized: number;
  dropped: number;
  bytesSaved: number;
};

export function totalBytes(sizes: readonly number[]): number {
  let total = 0;
  for (const size of sizes) total += size;
  return total;
}

type Trim = { count: number; remaining: number };

function trimOldest(sizes: readonly number[], target: number, protectNewest: boolean): Trim {
  const limit = protectNewest ? sizes.length - 1 : sizes.length;
  let remaining = totalBytes(sizes);
  let count = 0;
  while (count < limit && remaining > target) {
    remaining -= sizes[count] ?? 0;
    count += 1;
  }
  return { count, remaining };
}

/**
 * Choose how many of the oldest images to redact to fit the budget.
 *
 * The newest images stay while an older image can free enough room, because the newest images are
 * the ones the model is working on. The newest image is redacted only when it alone still exceeds
 * the budget. Redaction targets `redactToBytes` instead of the budget itself, so the next few
 * screenshots do not trigger another pass and invalidate the prompt cache again.
 */
export function planRedactions(sizes: readonly number[], config: ImageBudgetConfig): RedactionPlan {
  const bytesBefore = totalBytes(sizes);
  const empty: RedactionPlan = {
    redactCount: 0,
    bytesBefore,
    bytesAfter: bytesBefore,
    redactedBytes: 0,
  };
  if (!config.enabled || bytesBefore <= config.imageBudgetBytes) return empty;
  const target = Math.min(config.redactToBytes, config.imageBudgetBytes);
  let trim = trimOldest(sizes, target, true);
  if (trim.remaining > config.imageBudgetBytes) {
    trim = trimOldest(sizes, config.imageBudgetBytes, false);
  }
  return {
    redactCount: trim.count,
    bytesBefore,
    bytesAfter: trim.remaining,
    redactedBytes: bytesBefore - trim.remaining,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} B`;
}

export const REDACTED_MARKER = "[image redacted: session image budget]";

/** Note placed where the oldest redacted image was. */
export function redactionNote(
  redacted: readonly ImageRef[],
  keptImages: number,
  budgetBytes: number,
): string {
  const bytes = totalBytes(redacted.map((image) => image.bytes));
  const tools = [...new Set(redacted.map((image) => image.toolName ?? "unknown tool"))];
  return [
    `[${String(redacted.length)} image${redacted.length === 1 ? "" : "s"} redacted by image-budget`,
    `${formatBytes(bytes)} from ${tools.join(", ")};`,
    `${String(keptImages)} images kept to stay under the ${formatBytes(budgetBytes)} request image budget.`,
    "Re-run the tool or re-render the view if you need an image again.]",
  ].join(" ");
}

export function omittedNote(omitted: number, limit: number): string {
  return `[${String(omitted)} image${omitted === 1 ? "" : "s"} omitted by image-budget: at most ${String(limit)} images per tool result.]`;
}

export function resizeFailureNote(bytes: number, mimeType: string, limit: number): string {
  return `[image dropped by image-budget: ${formatBytes(bytes)} ${mimeType} could not be re-encoded under ${formatBytes(limit)}.]`;
}

export function resultOutcomeNotice(outcome: ResultOutcome): string | undefined {
  const parts: string[] = [];
  if (outcome.resized > 0) parts.push(`re-encoded ${String(outcome.resized)}`);
  if (outcome.omitted > 0) parts.push(`omitted ${String(outcome.omitted)}`);
  if (outcome.dropped > 0) parts.push(`dropped ${String(outcome.dropped)}`);
  if (parts.length === 0) return undefined;
  const changed = outcome.resized + outcome.omitted + outcome.dropped;
  return `image-budget: ${parts.join(", ")} image${changed === 1 ? "" : "s"} (${formatBytes(outcome.bytesSaved)} saved)`;
}

export function redactionNotice(summary: RedactionSummary): string {
  return `image-budget: redacted ${String(summary.redactCount)} old image${summary.redactCount === 1 ? "" : "s"}, ${formatBytes(summary.bytesBefore)} -> ${formatBytes(summary.bytesAfter)}`;
}

export function formatStatus(bytes: number, budgetBytes: number): string {
  return `images ${formatBytes(bytes)}/${formatBytes(budgetBytes)}`;
}
