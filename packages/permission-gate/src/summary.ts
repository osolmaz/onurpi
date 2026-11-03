/** Longest part of a call description shown in the approval prompt, before the tool name. */
export const MAX_DETAIL_LENGTH = 320;

/** Input words that identify a call well enough to approve it. */
const DETAIL_KEYS = ["command", "cmd", "path", "file_path", "session_id"] as const;

export function describeCall(toolName: string, input: Record<string, unknown>): string {
  const detail = collapse(detailOf(input));
  if (detail === "") return toolName;
  return `${toolName}: ${truncate(detail)}`;
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
  return `${text.slice(0, MAX_DETAIL_LENGTH)}...`;
}
