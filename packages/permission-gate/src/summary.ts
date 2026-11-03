/** Longest part of a call description shown in the approval prompt. */
export const MAX_DETAIL_LENGTH = 1200;

/**
 * Input words that identify a call well enough to approve it. The order matters: the first word
 * with a usable value wins, so a session id never hides the text written to that session.
 */
const DETAIL_KEYS = [
  "command",
  "cmd",
  "code",
  "chars",
  "chars_b64",
  "path",
  "file_path",
  "session_id",
] as const;

/**
 * Characters that can hide text from the user or move the cursor: C0 and C1 controls, and the
 * bidirectional and zero-width characters that reverse or hide what follows. The ranges are built
 * from code points so this file holds no control character of its own.
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];

const HIDDEN_CHARACTERS = new RegExp(`[${HIDDEN_RANGES.map(characterClassRange).join("")}]`, "gu");

function characterClassRange([start, end]: readonly [number, number]): string {
  return `${String.fromCodePoint(start)}-${String.fromCodePoint(end)}`;
}

export function describeCall(toolName: string, input: Record<string, unknown>): string {
  const detail = collapse(showHiddenCharacters(detailOf(input)));
  if (detail === "") return toolName;
  return `${toolName}: ${truncate(detail)}`;
}

/** Replace every hidden character with a visible escape, so the dialog shows what will run. */
export function showHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTERS, escapeCharacter);
}

function escapeCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  const width = code <= 0xff ? 2 : 4;
  const prefix = code <= 0xff ? "\\x" : "\\u";
  return `${prefix}${code.toString(16).padStart(width, "0")}`;
}

function detailOf(input: Record<string, unknown>): string {
  for (const key of DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return stringifyInput(input);
}

function stringifyInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_DETAIL_LENGTH) return text;
  return `${text.slice(0, MAX_DETAIL_LENGTH)}... [truncated]`;
}
