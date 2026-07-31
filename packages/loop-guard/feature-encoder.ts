import { createHash, type Hash } from "node:crypto";
import { basename, extname } from "node:path";

export const MAX_EPISODES = 12;
export const MAX_TURNS_PER_EPISODE = 16;
export const MAX_ACTIONS_PER_EPISODE = 32;
export const MAX_FEATURES_PER_EPISODE = 256;
export const MAX_TEXT_BYTES_PER_VALUE = 4_096;

const MAX_ARGUMENT_DEPTH = 4;
const MAX_ARRAY_ITEMS = 12;
const MAX_OBJECT_KEYS = 24;
const MAX_ARGUMENT_STRING = 1_024;
const VOLATILE_KEYS = new Set([
  "api",
  "model",
  "provider",
  "responseId",
  "thoughtSignature",
  "thinkingSignature",
  "timestamp",
  "toolCallId",
  "usage",
]);
const COMMAND_KEYS = new Set(["cmd", "command"]);
const PATH_KEYS = new Set(["file", "filePath", "path"]);

export type EpisodeDigest = {
  actionFeatures: readonly number[];
  continuationPrompt: boolean;
  exactOutcomeHash: string;
  terminalError: boolean;
  terminalErrorFingerprint: string | null;
  toolCalls: number;
  truncated: boolean;
  turns: number;
};

type JsonValue = boolean | null | number | string | JsonValue[] | JsonRecord;
type JsonRecord = { readonly [key: string]: JsonValue };

type Budget = {
  remainingNodes: number;
  truncated: boolean;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string, maximum = MAX_TEXT_BYTES_PER_VALUE): string {
  if (Buffer.byteLength(value, "utf8") <= maximum) return value;
  const marker = `<truncated:${String(value.length)}>`;
  const characterBudget = Math.max(0, Math.floor((maximum - marker.length) / 8));
  return `${value.slice(0, characterBudget)}${marker}${value.slice(-characterBudget)}`;
}

export function normalizeVolatileText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, "<uuid>")
    .replaceAll(/\b(?:0x)?[0-9a-f]{12,}\b/giu, "<id>")
    .replaceAll(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/giu, "<n>")
    .replaceAll(/\/tmp\/[^\s'";|&]+/gu, "/tmp/<tmp>")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function hashFeature(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function canonicalPrimitive(value: unknown): JsonValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  return undefined;
}

function canonicalArray(value: readonly unknown[], budget: Budget, depth: number): JsonValue[] {
  if (value.length > MAX_ARRAY_ITEMS) budget.truncated = true;
  return value.slice(0, MAX_ARRAY_ITEMS).map((item) => canonicalValue(item, budget, depth + 1));
}

function canonicalRecord(
  value: Readonly<Record<string, unknown>>,
  budget: Budget,
  depth: number,
): JsonRecord {
  const keys = Object.keys(value)
    .filter((key) => !VOLATILE_KEYS.has(key) && !(key === "id" && value["type"] === "toolCall"))
    .sort();
  if (keys.length > MAX_OBJECT_KEYS) budget.truncated = true;
  const result: Record<string, JsonValue> = {};
  for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = canonicalValue(value[key], budget, depth + 1);
  }
  return result;
}

function canonicalValue(value: unknown, budget: Budget, depth = 0): JsonValue {
  if (budget.remainingNodes <= 0 || depth >= MAX_ARGUMENT_DEPTH + 2) {
    budget.truncated = true;
    return "<bounded>";
  }
  budget.remainingNodes -= 1;
  const primitive = canonicalPrimitive(value);
  if (primitive !== undefined) return primitive;
  if (Array.isArray(value)) return canonicalArray(value, budget, depth);
  return isRecord(value) ? canonicalRecord(value, budget, depth) : `<${typeof value}>`;
}

function projectedToolCall(item: Readonly<Record<string, unknown>>, budget: Budget): JsonValue {
  return {
    arguments: canonicalValue(item["arguments"], budget),
    name: typeof item["name"] === "string" ? item["name"] : "unknown",
    type: "toolCall",
  };
}

type ProjectedContentItem = {
  image: boolean;
  text?: string;
  value?: JsonValue;
};

function projectContentItem(item: unknown, budget: Budget): ProjectedContentItem {
  if (!isRecord(item)) return { image: false };
  if (item["type"] === "text" && typeof item["text"] === "string") {
    return { image: false, text: item["text"] };
  }
  if (item["type"] === "toolCall") {
    return { image: false, value: projectedToolCall(item, budget) };
  }
  return { image: item["type"] === "image" };
}

function contentProjection(value: unknown, budget: Budget): JsonValue {
  if (!Array.isArray(value)) return [];
  const projection: JsonValue[] = [];
  const text: string[] = [];
  let imageSeen = false;
  for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
    const projected = projectContentItem(item, budget);
    if (projected.text !== undefined) text.push(projected.text);
    if (projected.value !== undefined) projection.push(projected.value);
    imageSeen ||= projected.image;
  }
  if (text.length > 0) projection.unshift({ text: boundedText(text.join("\n")), type: "text" });
  if (imageSeen) projection.push({ type: "image" });
  return projection;
}

function observableMessage(value: unknown, budget: Budget): JsonValue {
  if (!isRecord(value)) return "<invalid-message>";
  if (value["role"] === "assistant") {
    return {
      content: contentProjection(value["content"], budget),
      errorMessage:
        typeof value["errorMessage"] === "string" ? boundedText(value["errorMessage"]) : null,
      role: "assistant",
      stopReason: typeof value["stopReason"] === "string" ? value["stopReason"] : null,
    };
  }
  if (value["role"] === "toolResult") {
    return {
      content: contentProjection(value["content"], budget),
      isError: value["isError"] === true,
      role: "toolResult",
      toolName: typeof value["toolName"] === "string" ? value["toolName"] : "unknown",
    };
  }
  return "<ignored-message>";
}

function commandTokens(command: string): string[] {
  return (
    normalizeVolatileText(boundedText(command, MAX_ARGUMENT_STRING)).match(
      /--?[a-z][a-z0-9-]*|[a-z_][a-z0-9_.-]*|<[^>]+>/gu,
    ) ?? []
  ).slice(0, 80);
}

function addCommandFeatures(command: string, add: (feature: string) => void): void {
  const tokens = commandTokens(command);
  for (const token of tokens) add(`command-token:${token}`);
  for (let index = 1; index < tokens.length; index += 1) {
    add(`command-pair:${tokens[index - 1] ?? ""}:${tokens[index] ?? ""}`);
  }
}

function addPathFeatures(path: string, add: (feature: string) => void): void {
  const normalized = normalizeVolatileText(path);
  add(`path-base:${basename(normalized)}`);
  const extension = extname(normalized);
  if (extension) add(`path-extension:${extension}`);
}

function addStringFeatures(path: string, value: string, add: (feature: string) => void): void {
  if (COMMAND_KEYS.has(path)) {
    addCommandFeatures(value, add);
    return;
  }
  if (PATH_KEYS.has(path)) {
    addPathFeatures(value, add);
    return;
  }
  const tokens = commandTokens(value).slice(0, 24);
  for (const token of tokens) add(`argument-token:${path}:${token}`);
}

function addPrimitiveArgument(
  value: unknown,
  path: string,
  add: (feature: string) => void,
): boolean {
  if (typeof value === "string") {
    addStringFeatures(path, boundedText(value, MAX_ARGUMENT_STRING), add);
    return true;
  }
  if (typeof value === "number") {
    add(`argument-number:${path}`);
    return true;
  }
  if (typeof value === "boolean" || value === null || value === undefined) {
    add(`argument-value:${path}:${String(value)}`);
    return true;
  }
  return false;
}

function addArrayArguments(
  value: readonly unknown[],
  path: string,
  depth: number,
  add: (feature: string) => void,
): void {
  add(`argument-array:${path}`);
  for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
    walkArguments(item, path, depth + 1, add);
  }
}

function addRecordArguments(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  add: (feature: string) => void,
): void {
  const keys = Object.keys(value).sort().slice(0, MAX_OBJECT_KEYS);
  for (const key of keys) {
    add(`argument-key:${key}`);
    walkArguments(value[key], key, depth + 1, add);
  }
}

function walkArguments(
  value: unknown,
  path: string,
  depth: number,
  add: (feature: string) => void,
): void {
  if (depth >= MAX_ARGUMENT_DEPTH) {
    add(`argument-depth:${path}`);
    return;
  }
  if (addPrimitiveArgument(value, path, add)) return;
  if (Array.isArray(value)) {
    addArrayArguments(value, path, depth, add);
    return;
  }
  if (isRecord(value)) {
    addRecordArguments(value, depth, add);
    return;
  }
  add(`argument-type:${path}:${typeof value}`);
}

function toolCalls(message: unknown): Readonly<Record<string, unknown>>[] {
  if (!isRecord(message) || message["role"] !== "assistant" || !Array.isArray(message["content"])) {
    return [];
  }
  return message["content"].filter(
    (item): item is Readonly<Record<string, unknown>> =>
      isRecord(item) && item["type"] === "toolCall",
  );
}

function normalizeErrorText(value: string): string {
  return boundedText(value)
    .toLowerCase()
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, "<uuid>")
    .replaceAll(/\b(?:0x)?[0-9a-f]{12,}\b/giu, "<id>")
    .replaceAll(/\b(request|trace|attempt|pid|id)[\s:=#-]+\d+\b/giu, "$1 <n>")
    .replaceAll(/\/tmp\/[^\s'";|&]+/gu, "/tmp/<tmp>")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function terminalError(message: unknown): { error: boolean; fingerprint: string | null } {
  if (!isRecord(message) || message["role"] !== "assistant" || message["stopReason"] !== "error") {
    return { error: false, fingerprint: null };
  }
  const errorMessage =
    typeof message["errorMessage"] === "string" ? message["errorMessage"] : "terminal error";
  const digest = createHash("sha256").update(normalizeErrorText(errorMessage)).digest("hex");
  return { error: true, fingerprint: `v1:${digest}` };
}

export function actionFeatureSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightFeatures = new Set(right);
  const intersection = left.filter((feature) => rightFeatures.has(feature)).length;
  return intersection / (left.length + right.length - intersection);
}

export class EpisodeBuilder {
  private readonly actionFeatureSet = new Set<number>();
  private readonly outcomeHash: Hash = createHash("sha256");
  private terminalErrorFingerprint: string | null = null;
  private terminalErrorSeen = false;
  private toolCallCount = 0;
  private truncated = false;
  private turnCount = 0;

  get turns(): number {
    return this.turnCount;
  }

  accountTurn(message: unknown, toolResults: readonly unknown[]): void {
    this.turnCount = Math.min(this.turnCount + 1, MAX_TURNS_PER_EPISODE + 1);
    if (this.turnCount > MAX_TURNS_PER_EPISODE) {
      this.truncated = true;
      return;
    }

    const budget: Budget = { remainingNodes: 512, truncated: false };
    const projected = [
      observableMessage(message, budget),
      ...toolResults
        .slice(0, MAX_ACTIONS_PER_EPISODE)
        .map((result) => observableMessage(result, budget)),
    ];
    this.outcomeHash.update(JSON.stringify(projected));
    this.truncated ||= budget.truncated || toolResults.length > MAX_ACTIONS_PER_EPISODE;

    const error = terminalError(message);
    if (error.error) {
      this.terminalErrorSeen = true;
      this.terminalErrorFingerprint = error.fingerprint;
    }

    for (const call of toolCalls(message)) this.accountToolCall(call);
  }

  accountAgentEnd(messages: readonly unknown[]): void {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const error = terminalError(messages[index]);
      if (!error.error) continue;
      this.terminalErrorSeen = true;
      this.terminalErrorFingerprint = error.fingerprint;
      return;
    }
  }

  private accountToolCall(call: Readonly<Record<string, unknown>>): void {
    this.toolCallCount = Math.min(this.toolCallCount + 1, MAX_ACTIONS_PER_EPISODE + 1);
    if (this.toolCallCount > MAX_ACTIONS_PER_EPISODE) {
      this.truncated = true;
      return;
    }
    const name = typeof call["name"] === "string" ? call["name"] : "unknown";
    this.addFeature(`tool:${name}`);
    walkArguments(call["arguments"], "arguments", 0, (feature) => {
      this.addFeature(`tool:${name}:${feature}`);
    });
  }

  private addFeature(feature: string): void {
    const hashed = hashFeature(feature);
    if (this.actionFeatureSet.has(hashed)) return;
    if (this.actionFeatureSet.size >= MAX_FEATURES_PER_EPISODE) {
      this.truncated = true;
      return;
    }
    this.actionFeatureSet.add(hashed);
  }

  finish(continuationPrompt: boolean): EpisodeDigest {
    return {
      actionFeatures: [...this.actionFeatureSet].sort((left, right) => left - right),
      continuationPrompt,
      exactOutcomeHash: `v1:${this.outcomeHash.digest("hex")}`,
      terminalError: this.terminalErrorSeen,
      terminalErrorFingerprint: this.terminalErrorFingerprint,
      toolCalls: this.toolCallCount,
      truncated: this.truncated,
      turns: this.turnCount,
    };
  }
}
