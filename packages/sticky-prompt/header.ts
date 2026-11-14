import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const PROMPT_MARK = "›";
export const HEADER_SOURCE_LIMIT = 512;
export const ATTACHMENT_LABEL = "[attachments]";

const WHITESPACE = /\s+/gu;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function contentItems(message: unknown): readonly unknown[] {
  if (!isRecord(message)) return [];
  const content = message["content"];
  return Array.isArray(content) ? content : [];
}

function itemType(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const type = item["type"];
  return typeof type === "string" ? type : undefined;
}

function itemText(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const text = item["text"];
  return typeof text === "string" ? text : undefined;
}

function joinMessageText(message: unknown): { attachments: number; text: string } {
  const texts: string[] = [];
  let attachments = 0;
  for (const item of contentItems(message)) {
    if (itemType(item) === "image") attachments += 1;
    const text = itemText(item);
    if (text) texts.push(text);
  }
  return { attachments, text: texts.join(" ") };
}

/** One-line prompt summary for a user message, or undefined when it has no visible text. */
export function headerSource(message: unknown): string | undefined {
  if (typeof message === "string") return collapse(message);
  const { attachments, text } = joinMessageText(message);
  const collapsed = collapse(text);
  if (collapsed !== undefined) return collapsed;
  return attachments > 0 ? ATTACHMENT_LABEL : undefined;
}

function collapse(value: string): string | undefined {
  const collapsed = value.replace(WHITESPACE, " ").trim().slice(0, HEADER_SOURCE_LIMIT);
  return collapsed.length > 0 ? collapsed : undefined;
}

export function headerBody(source: string): string {
  return `${PROMPT_MARK} ${source}`;
}

/** Truncate the header to the viewport width and pad it so a background fills the row. */
export function fitHeader(body: string, width: number): string | undefined {
  if (width < 1) return undefined;
  const truncated = truncateToWidth(body, width, "");
  if (!truncated) return undefined;
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

export function styledHeader(
  source: string,
  width: number,
  theme: Theme | undefined,
): string | undefined {
  const line = fitHeader(headerBody(source), width);
  if (line === undefined || theme === undefined) return line;
  return theme.bg("userMessageBg", theme.fg("userMessageText", line));
}
