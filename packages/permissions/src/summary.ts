import { decodeEscapes } from "./escapes.ts";

/** Longest part shown for one input field, and for the whole description. */
export const MAX_FIELD_LENGTH = 400;
export const MAX_DETAIL_LENGTH = 1200;

/** The field that identifies a call, in the order that the caller reads it. */
const PRIMARY_KEYS = ["command", "cmd", "code", "chars", "chars_b64", "path", "file_path"] as const;

/** Fields that say what happens to the primary value, or which process it reaches. */
const OTHER_KEYS = ["shell", "workdir", "session_id", "content", "edits", "url", "query"] as const;

/**
 * Characters that can hide text from the user or move the cursor: controls, format characters,
 * line and paragraph separators, and every code point that Unicode says a renderer may ignore.
 */
const HIDDEN_CHARACTERS =
  /\\|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/**
 * Describe one call for the approval dialog. Every value the model sent is shown, so an approval
 * covers what the user saw, and the primary value comes first.
 */
export function describeCall(toolName: string, input: Record<string, unknown>): string {
  const parts = fieldParts(input);
  if (parts.length === 0) return `${toolName}: (empty input)`;
  return `${toolName}: ${truncate(collapse(parts.join(" | ")))}`;
}

/** Replace every hidden character and every backslash with a visible escape. */
export function showHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTERS, (character) => {
    if (character === "\\") return "\\\\";
    if (character === " ") return character;
    return escapeCharacter(character);
  });
}

function escapeCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0xff) return `\\x${code.toString(16).padStart(2, "0")}`;
  if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, "0")}`;
  return `\\u{${code.toString(16)}}`;
}

function fieldParts(input: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [index, key] of orderedKeys(input).entries()) {
    const value = fieldText(key, input[key]);
    if (value === "") continue;
    const shown = showHiddenCharacters(cutField(value));
    parts.push(unlabelled(index, key) ? shown : `${key}=${shown}`);
  }
  return parts;
}

/** The first field stays unlabelled only when it is the value that names the call. */
function unlabelled(index: number, key: string): boolean {
  return index === 0 && (PRIMARY_KEYS as readonly string[]).includes(key);
}

function orderedKeys(input: Record<string, unknown>): string[] {
  const known: string[] = [...PRIMARY_KEYS, ...OTHER_KEYS].filter((key) => key in input);
  const rest = Object.keys(input).filter((key) => !known.includes(key));
  return [...known, ...rest];
}

/** Input that the caller decodes before it acts on it, so the dialog must show the result. */
const DECODERS: Readonly<Record<string, (value: string) => string>> = {
  chars: decodeEscapes,
  chars_b64: decodeBase64,
};

function fieldText(key: string, value: unknown): string {
  const text = rawText(value);
  const decoder = DECODERS[key];
  return decoder === undefined ? text : decoder(text);
}

function rawText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "";
  return stringifyValue(value);
}

/** Base64 input is what gets written to the session, so show the text it stands for. */
function decodeBase64(value: string): string {
  if (value === "") return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function cutField(text: string): string {
  if (text.length <= MAX_FIELD_LENGTH) return text;
  const rest = text.length - MAX_FIELD_LENGTH;
  return `${text.slice(0, MAX_FIELD_LENGTH)}... [${String(rest)} more characters]`;
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_DETAIL_LENGTH) return text;
  const rest = text.length - MAX_DETAIL_LENGTH;
  return `${text.slice(0, MAX_DETAIL_LENGTH)}... [${String(rest)} more characters]`;
}
