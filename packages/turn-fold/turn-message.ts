export type AssistantSnapshot = {
  hasTerminalNotice: boolean;
  hasVisibleContent: boolean;
  interrupted: boolean;
  key: string;
  terminalErrorToolCallIds: string[];
  timestamp: number;
  toolCallIds: string[];
};

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

export function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function contentItems(message: unknown): readonly unknown[] {
  if (!isRecord(message)) return [];
  return Array.isArray(message["content"]) ? message["content"] : [];
}

function hasNonBlankContent(value: unknown, type: string, key: string): boolean {
  if (stringField(value, "type") !== type) return false;
  return Boolean(stringField(value, key)?.trim());
}

function summarizeAssistantContent(items: readonly unknown[]): {
  hasVisibleContent: boolean;
  toolCallIds: string[];
} {
  let hasVisibleContent = false;
  const toolCallIds: string[] = [];
  for (const item of items) {
    if (hasNonBlankContent(item, "text", "text")) hasVisibleContent = true;
    if (hasNonBlankContent(item, "thinking", "thinking")) hasVisibleContent = true;
    const toolCallId =
      stringField(item, "type") === "toolCall" ? stringField(item, "id") : undefined;
    if (toolCallId) toolCallIds.push(toolCallId);
  }
  return { hasVisibleContent, toolCallIds };
}

export function assistantSnapshot(message: unknown, key: string): AssistantSnapshot | undefined {
  if (stringField(message, "role") !== "assistant") return undefined;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === undefined) return undefined;

  const { hasVisibleContent, toolCallIds } = summarizeAssistantContent(contentItems(message));
  const stopReason = stringField(message, "stopReason");
  return {
    hasTerminalNotice:
      stopReason === "aborted" ||
      stopReason === "length" ||
      (stopReason === "error" && toolCallIds.length === 0),
    hasVisibleContent,
    interrupted: stopReason === "aborted",
    key,
    terminalErrorToolCallIds: stopReason === "error" ? toolCallIds : [],
    timestamp,
    toolCallIds,
  };
}

export function messageFromEntry(entry: unknown): unknown {
  if (!isRecord(entry) || entry["type"] !== "message") return undefined;
  return entry["message"];
}

export function entryTimestamp(entry: unknown): number | undefined {
  if (!isRecord(entry)) return undefined;
  const timestamp = entry["timestamp"];
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp !== "string") return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}
