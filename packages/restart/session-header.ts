import { closeSync, openSync, readSync } from "node:fs";

const CHUNK_SIZE = 4096;
const MAX_FIRST_LINE_BYTES = 64 * 1024;

type SessionHeader = {
  type: "session";
  id: string;
  cwd: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFirstLine(path: string): string {
  const descriptor = openSync(path, "r");
  try {
    return readFirstLineFromDescriptor(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readFirstLineFromDescriptor(descriptor: number): string {
  const chunks: Buffer[] = [];
  let retained = 0;
  while (retained < MAX_FIRST_LINE_BYTES) {
    const result = readChunk(descriptor, MAX_FIRST_LINE_BYTES - retained);
    chunks.push(result.content);
    retained += result.content.length;
    if (result.complete) return Buffer.concat(chunks, retained).toString("utf8");
  }
  throw new Error("Session header exceeds 64 KiB.");
}

function readChunk(descriptor: number, remaining: number): { content: Buffer; complete: boolean } {
  const size = Math.min(CHUNK_SIZE, remaining);
  const buffer = Buffer.allocUnsafe(size);
  const count = readSync(descriptor, buffer, 0, size, null);
  if (count === 0) return { content: Buffer.alloc(0), complete: true };
  const content = buffer.subarray(0, count);
  const newline = content.indexOf(0x0a);
  if (newline < 0) return { content, complete: false };
  return { content: content.subarray(0, newline), complete: true };
}

function parseHeader(firstLine: string): SessionHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new Error("Session file does not start with valid JSON.");
  }
  if (!isRecord(parsed) || parsed["type"] !== "session") {
    throw new Error("Session file does not start with a session header.");
  }
  const id = parsed["id"];
  const cwd = parsed["cwd"];
  if (typeof id !== "string" || !id || typeof cwd !== "string" || !cwd) {
    throw new Error("Session header is missing its id or cwd.");
  }
  return { type: "session", id, cwd };
}

export function readSessionHeader(path: string): SessionHeader {
  return parseHeader(readFirstLine(path));
}
