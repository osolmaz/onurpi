export const TRANSCRIPT_DENSITIES = ["compact", "expanded"] as const;

export type TranscriptDensity = (typeof TRANSCRIPT_DENSITIES)[number];

export function isTranscriptDensity(value: unknown): value is TranscriptDensity {
  return TRANSCRIPT_DENSITIES.some((density) => density === value);
}

export function nextTranscriptDensity(density: TranscriptDensity): TranscriptDensity {
  return density === "compact" ? "expanded" : "compact";
}
