import type { Theme } from "@earendil-works/pi-coding-agent";

import type { CatContextStress } from "./cat-state.ts";

export type CatStyler = (cat: string) => string;
export type CatTheme = Pick<Theme, "fg">;
export type CatColorToken = "warning" | "thinkingHigh" | "error";

export function catColorToken(stress: CatContextStress): CatColorToken | undefined {
  if (stress === "watch") return "warning";
  if (stress === "stressed") return "thinkingHigh";
  if (stress === "critical") return "error";
  return undefined;
}

export function catStyler(theme: CatTheme, stress: CatContextStress): CatStyler | undefined {
  const token = catColorToken(stress);
  return token ? (cat) => theme.fg(token, cat) : undefined;
}
