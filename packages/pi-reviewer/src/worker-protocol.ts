import type { ThinkingLevel } from "./types.js";

export type ReviewWorkerRequest = {
  readonly version: 1;
  readonly cwd: string;
  readonly prompt: string;
  readonly authPath: string;
  readonly modelsPath: string;
  readonly configDir: string;
  readonly extensionPath: string;
  readonly systemPrompt: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: ThinkingLevel;
  readonly tools: readonly string[];
};

const MAX_WORKER_INPUT_BYTES = 2 * 1024 * 1024;

export async function readWorkerRequest(
  input: NodeJS.ReadableStream = process.stdin,
): Promise<ReviewWorkerRequest> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_WORKER_INPUT_BYTES) throw new Error("review worker input exceeded size limit");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error("review worker received invalid JSON", { cause: error });
  }
  return validateWorkerRequest(value);
}

export function validateWorkerRequest(value: unknown): ReviewWorkerRequest {
  if (!isRecord(value) || value["version"] !== 1) {
    throw new Error("review worker request must use version 1");
  }
  const allowed = new Set([
    "version",
    "cwd",
    "prompt",
    "authPath",
    "modelsPath",
    "configDir",
    "extensionPath",
    "systemPrompt",
    "provider",
    "model",
    "thinking",
    "tools",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0)
    throw new Error(`review worker request has unknown field ${unknown.join(", ")}`);
  const tools = value["tools"];
  if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === "string" && tool !== "")) {
    throw new Error("review worker tools must be nonempty strings");
  }
  return {
    version: 1,
    cwd: requiredString(value, "cwd"),
    prompt: requiredString(value, "prompt"),
    authPath: requiredString(value, "authPath"),
    modelsPath: requiredString(value, "modelsPath"),
    configDir: requiredString(value, "configDir"),
    extensionPath: requiredString(value, "extensionPath"),
    systemPrompt: requiredString(value, "systemPrompt"),
    provider: requiredString(value, "provider"),
    model: requiredString(value, "model"),
    thinking: thinkingLevel(value["thinking"]),
    tools,
  };
}

function requiredString(value: Readonly<Record<string, unknown>>, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || entry === "")
    throw new Error(`review worker ${key} is required`);
  return entry;
}

function thinkingLevel(value: unknown): ThinkingLevel {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      throw new Error("review worker thinking level is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
