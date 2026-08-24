import { createHash } from "node:crypto";

import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  convertToLlm,
  sessionEntryToContextMessages,
  type SessionEntry,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";

import { findNativeCheckpoint, modelKey, type ResponseItem } from "./native-checkpoint.ts";

export const RETAINED_USER_TOKEN_BUDGET = 64_000;

type AnyModel = Model<Api>;

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizedItemId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64)
    .replace(/_+$/, "");
  return sanitized.startsWith("fc_") ? sanitized : `fc_${sanitized}`.slice(0, 64);
}

type TextSignature = {
  id?: string;
  phase?: "commentary" | "final_answer";
};

function textSignature(value: string | undefined): TextSignature {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return { id: value };
    const record = parsed as Record<string, unknown>;
    const phase = record["phase"];
    return {
      ...(typeof record["id"] === "string" ? { id: record["id"] } : {}),
      ...(phase === "commentary" || phase === "final_answer" ? { phase } : {}),
    };
  } catch {
    // Not JSON: the signature itself is the item id.
    return { id: value };
  }
}

function imagePart(data: string, mimeType: string): ResponseItem {
  return { type: "input_image", detail: "auto", image_url: `data:${mimeType};base64,${data}` };
}

function contentToUserParts(content: UserMessage["content"]): ResponseItem[] {
  if (typeof content === "string") {
    return content ? [{ type: "input_text", text: content }] : [];
  }
  return content.flatMap((part): ResponseItem[] =>
    part.type === "text"
      ? [{ type: "input_text", text: part.text }]
      : [imagePart(part.data, part.mimeType)],
  );
}

function toolResultOutput(message: ToolResultMessage, model: AnyModel): unknown {
  const text = contentTextOf(message);
  const images = message.content.filter((part) => part.type === "image");
  if (images.length === 0 || !model.input.includes("image")) {
    return text || (images.length > 0 ? "(see attached image)" : "(no tool output)");
  }
  return [
    ...(text ? [{ type: "input_text", text }] : []),
    ...images.map((part) => imagePart(part.data, part.mimeType)),
  ];
}

function contentTextOf(message: ToolResultMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function responseTool(tool: ToolInfo, deferLoading = false): ResponseItem {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: null,
    ...(deferLoading ? { defer_loading: true } : {}),
  };
}

type ConversionState = {
  items: ResponseItem[];
  toolsByName: Map<string, ToolInfo>;
  pendingToolCalls: Map<string, string>;
  messageIndex: number;
};

function flushOrphanedToolCalls(state: ConversionState): void {
  for (const callId of state.pendingToolCalls.values()) {
    state.items.push({
      type: "function_call_output",
      call_id: callId,
      output: "No result provided",
    });
  }
  state.pendingToolCalls.clear();
}

function appendUserMessage(state: ConversionState, message: UserMessage): void {
  flushOrphanedToolCalls(state);
  const content = contentToUserParts(message.content);
  if (content.length > 0) state.items.push({ role: "user", content });
}

function reasoningItem(block: ThinkingContent): ResponseItem | undefined {
  const signature = block.thinkingSignature;
  if (typeof signature !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(signature);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>)["type"] === "reasoning"
    ) {
      const cloned = structuredClone(parsed) as ResponseItem;
      // `status` is a response-only field; replaying it in a request is rejected by the API.
      return omitKeys(cloned, ["status"]) as ResponseItem;
    }
  } catch {
    // Undecodable thinking signatures are dropped from the Responses replay.
  }
  return undefined;
}

type TextIndex = { message: number; textIndex: number };

function assistantTextItem(
  block: TextContent,
  index: TextIndex,
  sameProvider: boolean,
): ResponseItem {
  // Only the provider that minted a text signature may replay its response item id.
  const parsed = sameProvider ? textSignature(block.textSignature) : {};
  const fallbackId =
    index.textIndex === 0
      ? `msg_pi_${String(index.message)}`
      : `msg_pi_${String(index.message)}_${String(index.textIndex)}`;
  index.textIndex += 1;
  const rawId = parsed.id ?? fallbackId;
  const id = rawId.length <= 64 ? rawId : `msg_${shortHash(rawId)}`;
  return {
    type: "message",
    role: "assistant",
    id,
    content: [{ type: "output_text", text: block.text, annotations: [] }],
    ...(parsed.phase ? { phase: parsed.phase } : {}),
  };
}

function appendToolCall(state: ConversionState, block: ToolCall, sameProvider: boolean): void {
  const [callId, rawItemId] = block.id.split("|");
  // Only the provider that minted a tool call id may replay its response item id.
  const itemId = sameProvider ? normalizedItemId(rawItemId) : undefined;
  state.pendingToolCalls.set(block.id, callId ?? block.id);
  state.items.push({
    type: "function_call",
    call_id: callId ?? block.id,
    ...(itemId ? { id: itemId } : {}),
    name: block.name,
    arguments: JSON.stringify(block.arguments),
  });
}

function appendReasoning(
  state: ConversionState,
  block: ThinkingContent,
  sameProvider: boolean,
): void {
  if (!sameProvider) return;
  const reasoning = reasoningItem(block);
  if (reasoning) state.items.push(reasoning);
}

function appendAssistantMessage(
  state: ConversionState,
  message: AssistantMessage,
  model: AnyModel,
): void {
  flushOrphanedToolCalls(state);
  if (message.stopReason === "error" || message.stopReason === "aborted") return;

  // Reasoning state and response item ids are only valid for the provider and API that minted
  // them. Cross-provider history is replayed as plain text and bare tool calls instead.
  const sameProvider = message.provider === model.provider && message.api === model.api;

  const index: TextIndex = { message: state.messageIndex, textIndex: 0 };
  for (const block of message.content) {
    if (block.type === "thinking") {
      appendReasoning(state, block, sameProvider);
    } else if (block.type === "text") {
      state.items.push(assistantTextItem(block, index, sameProvider));
    } else {
      appendToolCall(state, block, sameProvider);
    }
  }
}

function toolSearchItems(
  message: ToolResultMessage,
  toolsByName: Map<string, ToolInfo>,
): ResponseItem[] {
  const addedTools = (message.addedToolNames ?? []).flatMap((name) => {
    const tool = toolsByName.get(name);
    return tool ? [tool] : [];
  });
  if (addedTools.length === 0) return [];
  const searchCallId = `pi_tool_load_${shortHash(
    `${message.toolCallId}:${addedTools.map((tool) => tool.name).join(",")}`,
  )}`;
  const query = addedTools.map((tool) => tool.name).join(" ");
  return [
    {
      type: "tool_search_call",
      call_id: searchCallId,
      execution: "client",
      status: "completed",
      arguments: { query, limit: addedTools.length },
    },
    {
      type: "tool_search_output",
      call_id: searchCallId,
      execution: "client",
      status: "completed",
      tools: addedTools.map((tool) => responseTool(tool, true)),
    },
  ];
}

function appendToolResultMessage(
  state: ConversionState,
  message: ToolResultMessage,
  model: AnyModel,
): void {
  const [callId] = message.toolCallId.split("|");
  state.pendingToolCalls.delete(message.toolCallId);
  state.items.push({
    type: "function_call_output",
    call_id: callId ?? message.toolCallId,
    output: toolResultOutput(message, model),
  });
  state.items.push(...toolSearchItems(message, state.toolsByName));
}

function convertMessage(state: ConversionState, message: Message, model: AnyModel): void {
  if (message.role === "user") {
    appendUserMessage(state, message);
  } else if (message.role === "assistant") {
    appendAssistantMessage(state, message, model);
  } else {
    appendToolResultMessage(state, message, model);
  }
  state.messageIndex += 1;
}

function messagesToResponseItems(
  model: AnyModel,
  messages: Message[],
  tools: ToolInfo[],
): ResponseItem[] {
  const state: ConversionState = {
    items: [],
    toolsByName: new Map(tools.map((tool) => [tool.name, tool])),
    pendingToolCalls: new Map(),
    messageIndex: 0,
  };
  for (const message of messages) {
    convertMessage(state, message, model);
  }
  flushOrphanedToolCalls(state);
  return state.items;
}

function entriesToResponseItems(
  model: AnyModel,
  entries: SessionEntry[],
  tools: ToolInfo[],
): ResponseItem[] {
  const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry));
  return messagesToResponseItems(model, convertToLlm(messages), tools);
}

function dropLastAssistantError(branch: SessionEntry[]): SessionEntry[] {
  let lastAssistantIndex = -1;
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) return branch;
  return branch.filter((_entry, index) => index !== lastAssistantIndex);
}

function inputFromCheckpoint(
  branch: SessionEntry[],
  model: AnyModel,
  tools: ToolInfo[],
): ResponseItem[] | undefined {
  const checkpoint = findNativeCheckpoint(branch);
  if (checkpoint.status === "invalid") {
    throw new Error("The latest OpenAI Codex native compaction checkpoint is malformed.");
  }
  if (checkpoint.status === "none") return undefined;
  if (checkpoint.checkpoint.details.modelKey !== modelKey(model)) {
    throw new Error(
      "The latest OpenAI Codex native compaction checkpoint belongs to a different model.",
    );
  }
  const tail = branch.slice(checkpoint.checkpoint.entryIndex + 1);
  return [
    ...checkpoint.checkpoint.details.replacementHistory.map((item) => structuredClone(item)),
    ...entriesToResponseItems(model, tail, tools),
  ];
}

/**
 * Build the exact Responses `input` for the current branch. When a valid native checkpoint exists,
 * its opaque replacement history replays first and only the entries after it are converted. Throws
 * on malformed or cross-model checkpoints so callers fail closed instead of sending Pi's local
 * marker summary to OpenAI.
 */
export function effectiveInputForBranch(params: {
  branch: SessionEntry[];
  model: AnyModel;
  tools: ToolInfo[];
  excludeLastAssistantError?: boolean;
}): ResponseItem[] {
  const branch = params.excludeLastAssistantError
    ? dropLastAssistantError(params.branch)
    : params.branch;

  const fromCheckpoint = inputFromCheckpoint(branch, params.model, params.tools);
  if (fromCheckpoint) return fromCheckpoint;

  const context = buildSessionContext(branch);
  return messagesToResponseItems(params.model, convertToLlm(context.messages), params.tools);
}

function partText(part: unknown): string | undefined {
  if (typeof part !== "object" || part === null) return undefined;
  const text = (part as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

function responseItemText(item: ResponseItem): string {
  if (item.type !== "message" && item.type !== undefined) return "";
  const content = item["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: unknown[] = content;
  return parts
    .flatMap((part) => {
      const text = partText(part);
      return text === undefined ? [] : [text];
    })
    .join("");
}

function approximateTokens(item: ResponseItem): number {
  return Math.max(1, Math.ceil(responseItemText(item).length / 4));
}

function truncateMiddle(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= 1) return text.slice(-maxCharacters);
  const marker = "…";
  const available = Math.max(0, maxCharacters - marker.length);
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(-tail) : ""}`;
}

function truncateStringContent(
  item: ResponseItem,
  maxCharacters: number,
): ResponseItem | undefined {
  const content = item["content"];
  if (typeof content !== "string") return undefined;
  const truncated = truncateMiddle(content, maxCharacters);
  return truncated ? { ...item, content: truncated } : undefined;
}

function truncateArrayContent(item: ResponseItem, maxCharacters: number): ResponseItem | undefined {
  const content = item["content"];
  if (!Array.isArray(content)) return item;
  const parts: unknown[] = content;
  const textLengths = parts.flatMap((part) => {
    const text = partText(part);
    return text === undefined ? [] : [text.length];
  });
  const totalText = textLengths.reduce((sum, length) => sum + length, 0);
  let consumed = 0;
  let remainingCharacters = maxCharacters;
  const truncatedContent = parts.flatMap((part) => {
    const text = partText(part);
    if (text === undefined) return [part];
    const remainingText = totalText - consumed;
    const partBudget =
      remainingText === 0 ? 0 : Math.floor((text.length / remainingText) * remainingCharacters);
    const truncated = truncateMiddle(text, partBudget);
    consumed += text.length;
    remainingCharacters -= partBudget;
    return truncated ? [{ ...(part as Record<string, unknown>), text: truncated }] : [];
  });
  if (truncatedContent.length === 0) return undefined;
  return { ...item, content: truncatedContent };
}

function truncateMessage(item: ResponseItem, maxTokens: number): ResponseItem | undefined {
  if ((item.type !== "message" && item.type !== undefined) || maxTokens <= 0) return undefined;
  const maxCharacters = maxTokens * 4;
  if (typeof item["content"] === "string") return truncateStringContent(item, maxCharacters);
  return truncateArrayContent(item, maxCharacters);
}

function isRetainedUserMessage(item: ResponseItem): boolean {
  if (item.type !== "message" && item.type !== undefined) return false;
  return item["role"] === "user" && responseItemText(item).trim().length > 0;
}

export function retainRecentUserMessages(
  items: ResponseItem[],
  maxTokens = RETAINED_USER_TOKEN_BUDGET,
): ResponseItem[] {
  let remaining = maxTokens;
  const retained: ResponseItem[] = [];
  for (const item of [...items].reverse()) {
    if (remaining <= 0) break;
    if (!isRetainedUserMessage(item)) continue;
    const tokens = approximateTokens(item);
    if (tokens <= remaining) {
      retained.push(structuredClone(item));
      remaining -= tokens;
      continue;
    }
    const truncated = truncateMessage(item, remaining);
    if (truncated) retained.push(truncated);
    remaining = 0;
  }
  return retained.reverse();
}

export function buildReplacementHistory(
  preCompactionInput: ResponseItem[],
  compactionItem: ResponseItem,
): ResponseItem[] {
  if (
    compactionItem.type !== "compaction" ||
    typeof compactionItem["encrypted_content"] !== "string"
  ) {
    throw new Error("OpenAI Codex did not return a valid compaction item.");
  }
  return [...retainRecentUserMessages(preCompactionInput), structuredClone(compactionItem)];
}

export function buildToolPayload(
  allTools: ToolInfo[],
  activeToolNames: string[],
): ResponseItem[] | undefined {
  const active = new Set(activeToolNames);
  const tools = allTools.filter((tool) => active.has(tool.name));
  return tools.length > 0 ? tools.map((tool) => responseTool(tool)) : undefined;
}

function omitKeys(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !excluded.has(key)));
}

function previousVerbosity(base: Record<string, unknown>): string | undefined {
  const baseText = base["text"];
  if (typeof baseText !== "object" || baseText === null || Array.isArray(baseText)) {
    return undefined;
  }
  const verbosity = (baseText as Record<string, unknown>)["verbosity"];
  return typeof verbosity === "string" ? verbosity : undefined;
}

function mergedInclude(base: Record<string, unknown>): string[] {
  const baseInclude = base["include"];
  const existing = Array.isArray(baseInclude)
    ? baseInclude.filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...existing, "reasoning.encrypted_content"])];
}

export function buildCompactionRequestBody(params: {
  basePayload?: Record<string, unknown>;
  model: AnyModel;
  input: ResponseItem[];
  instructions: string;
  tools?: ResponseItem[];
  sessionId: string;
}): Record<string, unknown> {
  const base: Record<string, unknown> = params.basePayload
    ? structuredClone(params.basePayload)
    : {};
  const verbosity = previousVerbosity(base);
  const body: Record<string, unknown> = {
    ...omitKeys(base, ["messages", "previous_response_id", "tools"]),
    model: params.model.id,
    store: false,
    stream: true,
    instructions: params.instructions,
    input: [...params.input.map((item) => structuredClone(item)), { type: "compaction_trigger" }],
    tool_choice: "auto",
    parallel_tool_calls: true,
    include: mergedInclude(base),
    prompt_cache_key: params.sessionId,
    text: { verbosity: verbosity ?? "low" },
  };
  if (params.tools) body["tools"] = params.tools;
  return body;
}

export function stripInputFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return omitKeys(structuredClone(payload), ["input", "messages", "previous_response_id"]);
}
