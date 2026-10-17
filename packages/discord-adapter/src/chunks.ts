/** Discord's limit for the text of one message. */
export const DISCORD_MESSAGE_LIMIT = 2000;

function cutPoint(text: string, limit: number): number {
  const paragraph = text.lastIndexOf("\n\n", limit);
  if (paragraph > limit / 2) return paragraph;
  const line = text.lastIndexOf("\n", limit);
  if (line > limit / 2) return line;
  const space = text.lastIndexOf(" ", limit);
  return space > limit / 2 ? space : limit;
}

/** Splits a reply into Discord-sized messages, preferring paragraph, then line, then word breaks. */
export function splitForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = cutPoint(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.length === 0 ? ["(empty answer)"] : chunks;
}
