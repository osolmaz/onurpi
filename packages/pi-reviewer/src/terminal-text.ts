export function terminalText(value: string): string {
  return Array.from(value, (character) =>
    isTerminalControl(character.codePointAt(0)) ? "�" : character,
  ).join("");
}

function isTerminalControl(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}
