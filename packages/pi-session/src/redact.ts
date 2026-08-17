import { truncateHead } from "@earendil-works/pi-coding-agent";

import type { Excerpt } from "./types.js";

const BASE64_RUN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{256,}={0,2}(?![A-Za-z0-9+/])/gu;
const DATA_URI = /data:(image|audio|video)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;

export function boundedExcerpt(value: string, maxBytes: number): Excerpt {
  const originalBytes = Buffer.byteLength(value);
  const omissions: string[] = [];
  let redactions = 0;
  let safe = value;

  safe = safe.replace(DATA_URI, (match, mediaType: string) => {
    omissions.push(`${mediaType} base64 payload (${String(Buffer.byteLength(match))} bytes)`);
    return `[${mediaType} base64 payload omitted]`;
  });
  safe = safe.replace(PRIVATE_KEY, () => {
    redactions += 1;
    return "[private key redacted]";
  });
  safe = safe.replace(BASE64_RUN, (match) => {
    omissions.push(`base64 payload (${String(Buffer.byteLength(match))} bytes)`);
    return `[base64 payload omitted: ${String(Buffer.byteLength(match))} bytes]`;
  });
  safe = replaceCounted(
    safe,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/giu,
    () => "Bearer <redacted>",
    () => {
      redactions += 1;
    },
  );
  safe = replaceCounted(
    safe,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,})\b/gu,
    () => "<redacted>",
    () => {
      redactions += 1;
    },
  );
  safe = replaceCounted(
    safe,
    /(["']?(?:access_token|refresh_token|api[_-]?key|apiKey|password|secret|authorization)["']?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/giu,
    (match) => redactAssignedValue(match),
    () => {
      redactions += 1;
    },
  );
  if (safe.includes("\0")) {
    const count = safe.match(/\0/gu)?.length ?? 0;
    omissions.push(`${String(count)} NUL byte${count === 1 ? "" : "s"}`);
    safe = safe.replaceAll("\0", "[binary byte omitted]");
  }

  const result = truncateHead(safe, { maxBytes, maxLines: 2_000 });
  const shownBytes = Buffer.byteLength(result.content);
  const omittedBytes = Math.max(0, originalBytes - shownBytes);
  return {
    text: result.content,
    originalBytes,
    shownBytes,
    omittedBytes,
    truncated: result.truncated || originalBytes !== Buffer.byteLength(safe),
    redactions,
    omissions,
  };
}

function replaceCounted(
  value: string,
  pattern: RegExp,
  replace: (match: string) => string,
  counted: () => void,
): string {
  return value.replace(pattern, (match: string) => {
    counted();
    return replace(match);
  });
}

function redactAssignedValue(match: string): string {
  const separator = Math.max(match.indexOf(":"), match.indexOf("="));
  if (separator < 0) return "<redacted>";
  const prefix = match.slice(0, separator + 1);
  const suffix = match
    .slice(separator + 1)
    .trimStart()
    .startsWith("'")
    ? "'<redacted>'"
    : '"<redacted>"';
  return `${prefix}${suffix}`;
}
