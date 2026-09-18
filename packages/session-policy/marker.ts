/**
 * The marker that replaces an ejected image payload.
 *
 * Pi persists whatever the `tool_result` hook returns, so the extension writes this marker into the
 * session instead of the base64 payload. The first line is machine-parseable and carries the cache
 * key plus the payload facts. The second line tells the model what happened and how to see the
 * picture again. Nothing else in the package builds marker text by hand.
 */

export type Marker = {
  /** sha256 of the cached base64 payload. This is the cache key. */
  hash: string;
  mimeType: string;
  /** Base64 characters in the cached payload. */
  chars: number;
  /** Source path from the tool input. Omitted when the tool input had no path. */
  source: string | undefined;
};

/** Matches the first line of a marker. */
export const MARKER_PATTERN =
  /^\[image-eject sha256=([0-9a-f]{64}) mime=(\S+) chars=(\d+)(?: source=(\S.*))?\]$/u;

export const MARKER_PREFIX = "[image-eject ";

const LIVE_SENTENCE =
  "This picture is attached while this result is in the live context. After compaction its bytes are gone.";
const REREAD_SENTENCE = "Re-read the source path to see it again.";

/** Keep a field on one line, so the first line always parses back. */
function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ");
}

export function buildMarkerText(marker: Marker): string {
  const fields = [
    `${MARKER_PREFIX}sha256=${marker.hash}`,
    `mime=${marker.mimeType}`,
    `chars=${String(marker.chars)}`,
  ];
  if (marker.source !== undefined) fields.push(`source=${singleLine(marker.source)}`);
  const head = `${fields.join(" ")}]`;
  const tail = marker.source === undefined ? LIVE_SENTENCE : `${LIVE_SENTENCE} ${REREAD_SENTENCE}`;
  return `${head}\n${tail}`;
}

export function parseMarkerText(text: string): Marker | undefined {
  const newline = text.indexOf("\n");
  const firstLine = newline < 0 ? text : text.slice(0, newline);
  const match = MARKER_PATTERN.exec(firstLine);
  if (match === null) return undefined;
  const hash = match[1];
  const mimeType = match[2];
  const chars = match[3];
  if (hash === undefined || mimeType === undefined || chars === undefined) return undefined;
  return { hash, mimeType, chars: Number(chars), source: match[4] };
}
