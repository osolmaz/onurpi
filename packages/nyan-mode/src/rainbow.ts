const RAINBOW_FOREGROUNDS = [196, 208, 226, 46, 51, 21, 201] as const;
const RESET_FOREGROUND = "\x1b[39m";

export function renderAnsiRainbow(cells: number): string {
  const width = Math.max(0, Math.floor(cells));
  let runway = "";
  for (let index = 0; index < width; index += 1) {
    const color = RAINBOW_FOREGROUNDS[index % RAINBOW_FOREGROUNDS.length];
    runway += `\x1b[38;5;${String(color)}m━`;
  }
  return runway ? `${runway}${RESET_FOREGROUND}` : "";
}
