import { calculateCost, type Api, type Model, type Usage } from "@earendil-works/pi-ai";

import { isJsonObject, type JsonObject, type ResponseItem } from "./native-checkpoint.ts";

export const REMOTE_COMPACTION_FEATURE = "remote_compaction_v2";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const MAX_REMOTE_RETRIES = 2;
const ERROR_BODY_PREVIEW = 300;

/**
 * Active Codex credentials may only leave the machine for these hosts. A custom model base URL is
 * a supported Pi feature, but it must never silently receive the ChatGPT OAuth token.
 */
const OFFICIAL_CODEX_HOSTS: ReadonlySet<string> = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "api.openai.com",
]);

export type RemoteCompactionResult = {
  compactionItem: ResponseItem;
  usage?: Usage;
};

class RemoteCompactionError extends Error {
  readonly retryable: boolean;
  readonly retryDelayMs: number | undefined;

  constructor(message: string, retryable: boolean, retryDelayMs?: number) {
    super(message);
    this.name = "RemoteCompactionError";
    this.retryable = retryable;
    this.retryDelayMs = retryDelayMs;
  }
}

function assertOfficialCodexEndpoint(normalized: string): void {
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("The OpenAI Codex endpoint is not a valid URL; compaction is disabled.");
  }
  const official =
    url.protocol === "https:" &&
    OFFICIAL_CODEX_HOSTS.has(url.hostname) &&
    (url.port === "" || url.port === "443") &&
    url.username === "" &&
    url.password === "";
  if (!official) {
    throw new Error(
      `Refusing to send OpenAI Codex credentials to non-official endpoint host "${url.hostname}".`,
    );
  }
}

/**
 * Resolve the Responses URL for native compaction. The endpoint is validated against the official
 * Codex hosts before any credential is attached; anything else fails closed.
 */
export function resolveCodexResponsesUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim() ?? "";
  const normalized = (trimmed.length > 0 ? trimmed : DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
  assertOfficialCodexEndpoint(normalized);
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

export function extractCodexAccountId(token: string): string {
  try {
    const parts = token.split(".");
    const encoded = parts[1];
    if (parts.length !== 3 || encoded === undefined) throw new Error("Invalid token");
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!isJsonObject(payload)) throw new Error("Invalid token payload");
    const auth = payload["https://api.openai.com/auth"];
    if (!isJsonObject(auth) || typeof auth["chatgpt_account_id"] !== "string") {
      throw new Error("Missing account ID");
    }
    return auth["chatgpt_account_id"];
  } catch {
    throw new Error("Failed to extract the ChatGPT account ID from the OpenAI Codex token.");
  }
}

export function mergeFeatureHeader(existing: string | null | undefined): string {
  const features = (existing ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...features, REMOTE_COMPACTION_FEATURE])].join(",");
}

export function buildCodexHeaders(params: {
  apiKey: string;
  headers?: Readonly<Record<string, string | null>>;
  sessionId: string;
}): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(params.headers ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${params.apiKey}`);
  headers.set("chatgpt-account-id", extractCodexAccountId(params.apiKey));
  headers.set("originator", "pi");
  headers.set("user-agent", "pi-codex-compaction");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("session-id", params.sessionId);
  headers.set("x-client-request-id", params.sessionId);
  headers.set("x-codex-beta-features", mergeFeatureHeader(headers.get("x-codex-beta-features")));
  return headers;
}

function parseRetryDelay(response: Response): number | undefined {
  const milliseconds = Number(response.headers.get("retry-after-ms"));
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Compaction aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type SseState = {
  completed: boolean;
  usage: unknown;
  compactionItems: ResponseItem[];
};

function isResponseItem(value: unknown): value is ResponseItem {
  if (!isJsonObject(value)) return false;
  return (
    typeof value["type"] === "string" ||
    (typeof value["role"] === "string" &&
      (typeof value["content"] === "string" || Array.isArray(value["content"])))
  );
}

function handleStreamError(event: JsonObject): void {
  const message = event["message"];
  if (typeof message !== "string" || !message.trim()) {
    throw new RemoteCompactionError("OpenAI Codex compaction failed.", true);
  }
  throw new RemoteCompactionError(message, false);
}

function handleTerminalEvent(event: JsonObject, state: SseState): void {
  if (event["type"] === "response.failed") {
    throw new RemoteCompactionError("OpenAI Codex compaction ended with response.failed.", false);
  }
  if (event["type"] === "response.incomplete") {
    throw new RemoteCompactionError(
      "OpenAI Codex compaction ended with response.incomplete.",
      true,
    );
  }
  state.completed = true;
  const responsePayload = event["response"];
  state.usage = isJsonObject(responsePayload) ? responsePayload["usage"] : undefined;
}

function recordCompactionItem(event: JsonObject, state: SseState): void {
  const item = event["item"];
  if (isResponseItem(item) && item.type === "compaction") state.compactionItems.push(item);
}

function handleResponseEvent(event: JsonObject, state: SseState, type: string): void {
  if (type === "response.failed" || type === "response.incomplete") {
    handleTerminalEvent(event, state);
    return;
  }
  if (type === "response.completed" || type === "response.done") {
    handleTerminalEvent(event, state);
    return;
  }
  if (type === "response.output_item.done") recordCompactionItem(event, state);
}

function handleSseEvent(event: JsonObject, state: SseState): void {
  const type = event["type"];
  if (type === "error") {
    handleStreamError(event);
    return;
  }
  if (typeof type === "string" && type.startsWith("response.")) {
    handleResponseEvent(event, state, type);
  }
}

function processSseBlock(block: string, state: SseState): void {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return;
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    throw new RemoteCompactionError("OpenAI Codex returned malformed compaction SSE data.", false);
  }
  if (isJsonObject(event)) handleSseEvent(event, state);
}

function finalizeSseState(state: SseState): { item: ResponseItem; usage: unknown } {
  if (!state.completed) {
    throw new RemoteCompactionError(
      "OpenAI Codex compaction stream closed before response.completed.",
      true,
    );
  }
  if (state.compactionItems.length !== 1) {
    throw new RemoteCompactionError(
      `OpenAI Codex returned ${String(state.compactionItems.length)} compaction items; expected exactly one.`,
      false,
    );
  }
  const item = state.compactionItems[0];
  if (!item || typeof item["encrypted_content"] !== "string") {
    throw new RemoteCompactionError(
      "OpenAI Codex returned a compaction item without encrypted_content.",
      false,
    );
  }
  return { item, usage: state.usage };
}

async function parseSseResponse(
  response: Response,
): Promise<{ item: ResponseItem; usage: unknown }> {
  const body: unknown = response.body;
  if (!(body instanceof ReadableStream)) {
    throw new Error("OpenAI Codex returned an empty compaction stream.");
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: SseState = { completed: false, usage: undefined, compactionItems: [] };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      processSseBlock(buffer.slice(0, boundary), state);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) processSseBlock(buffer, state);
  return finalizeSseState(state);
}

function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function usageFromResponse(model: Model<Api>, value: unknown): Usage | undefined {
  if (!isJsonObject(value)) return undefined;
  const inputTokens = numberField(value["input_tokens"]);
  const outputTokens = numberField(value["output_tokens"]);
  const details = isJsonObject(value["input_tokens_details"]) ? value["input_tokens_details"] : {};
  const cacheRead = numberField(details["cached_tokens"]);
  const cacheWrite = numberField(details["cache_write_tokens"]);
  const usage: Usage = {
    input: Math.max(0, inputTokens - cacheRead - cacheWrite),
    output: outputTokens,
    cacheRead,
    cacheWrite,
    totalTokens:
      typeof value["total_tokens"] === "number"
        ? value["total_tokens"]
        : inputTokens + outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

type RemoteCompactionParams = {
  url: string;
  headers: Headers;
  body: JsonObject;
  model: Model<Api>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

async function attemptRemoteCompaction(
  params: RemoteCompactionParams & { fetchImpl: typeof fetch },
): Promise<RemoteCompactionResult> {
  const response = await params.fetchImpl(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify(params.body),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (response.ok) {
    const parsed = await parseSseResponse(response);
    const usage = usageFromResponse(params.model, parsed.usage);
    return { compactionItem: parsed.item, ...(usage ? { usage } : {}) };
  }
  const body = await response.text().catch(() => "");
  const preview = (body || response.statusText).slice(0, ERROR_BODY_PREVIEW);
  const message = `OpenAI Codex compaction failed (${String(response.status)}): ${preview}`;
  throw new RemoteCompactionError(
    message,
    isRetryableStatus(response.status),
    parseRetryDelay(response),
  );
}

function retryDelayFor(error: unknown, attempt: number): number {
  if (error instanceof RemoteCompactionError && error.retryDelayMs !== undefined) {
    return error.retryDelayMs;
  }
  return 1000 * 2 ** attempt;
}

function isFinalFailure(error: unknown, attempt: number, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof RemoteCompactionError && !error.retryable) return true;
  return attempt === MAX_REMOTE_RETRIES;
}

export async function callRemoteCompaction(
  params: RemoteCompactionParams,
): Promise<RemoteCompactionResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_REMOTE_RETRIES; attempt++) {
    try {
      return await attemptRemoteCompaction({ ...params, fetchImpl });
    } catch (error) {
      lastError = error;
      if (isFinalFailure(error, attempt, params.signal)) throw error;
      await delay(retryDelayFor(error, attempt), params.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI Codex compaction failed.");
}
