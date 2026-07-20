function field(message: unknown, key: string): unknown {
  if (typeof message !== "object" || message === null) return undefined;
  return Reflect.get(message, key);
}

/** Stop reason of an assistant message, or undefined for anything else. */
export function assistantStopReason(message: unknown): string | undefined {
  if (field(message, "role") !== "assistant") return undefined;
  const stopReason = field(message, "stopReason");
  return typeof stopReason === "string" ? stopReason : undefined;
}

function textFromParts(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (field(item, "type") !== "text") continue;
    const text = field(item, "text");
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
}

/** Plain text of a user message, or undefined for anything else. */
export function userMessageText(message: unknown): string | undefined {
  if (field(message, "role") !== "user") return undefined;
  const content = field(message, "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return textFromParts(content as readonly unknown[]);
}
