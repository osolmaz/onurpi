const CHARS_PER_TOKEN = 4;

export type OutputTokenTotal = {
  approximate: boolean;
  tokens: number;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function serializedLength(value: Readonly<Record<string, unknown>>): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function toolCallCharacters(item: unknown): number {
  const nameLength = stringField(item, "name")?.length ?? 0;
  if (!isRecord(item) || !isRecord(item["arguments"])) return nameLength;
  return nameLength + serializedLength(item["arguments"]);
}

function contentItemCharacters(item: unknown): number {
  const type = stringField(item, "type");
  if (type === "text") return stringField(item, "text")?.length ?? 0;
  if (type === "thinking") return stringField(item, "thinking")?.length ?? 0;
  if (type === "toolCall") return toolCallCharacters(item);
  return 0;
}

function contentCharacters(message: Readonly<Record<string, unknown>>): number {
  const content = message["content"];
  if (!Array.isArray(content)) return 0;
  const items: unknown[] = content;
  let characters = 0;
  for (const item of items) characters += contentItemCharacters(item);
  return characters;
}

function reportedOutputTokens(message: Readonly<Record<string, unknown>>): number | undefined {
  const usage = message["usage"];
  if (!isRecord(usage)) return undefined;
  const output = usage["output"];
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? output : undefined;
}

export function deriveAssistantOutput(message: unknown): OutputTokenTotal {
  if (!isRecord(message) || message["role"] !== "assistant") {
    return { approximate: false, tokens: 0 };
  }

  const reported = reportedOutputTokens(message);
  if (reported !== undefined) return { approximate: false, tokens: reported };

  const characters = contentCharacters(message);
  const tokens = Math.ceil(characters / CHARS_PER_TOKEN);
  return { approximate: tokens > 0, tokens };
}

export function combineOutputTotals(totals: readonly OutputTokenTotal[]): OutputTokenTotal {
  let approximate = false;
  let tokens = 0;
  for (const total of totals) {
    tokens += total.tokens;
    approximate ||= total.approximate && total.tokens > 0;
  }
  return { approximate, tokens };
}
