import type { CollectedOutput } from "./collect.ts";
import type { ExactTotals } from "./tool-result.ts";

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

export function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/**
 * Bridge the bounded collector's payload and exact metadata into the
 * tool-result envelope fields. `omittedBytes` covers everything the retention
 * caps dropped during this drain; `exactTotals` keeps the truncation marker
 * and token estimate honest about the complete raw stream.
 */
export function envelopeFromCollected(collected: CollectedOutput): {
  collected: Uint8Array;
  omittedBytes: number;
  exactTotals: ExactTotals;
} {
  return {
    collected: collected.bytes,
    omittedBytes: collected.totalBytes - collected.bytes.length,
    exactTotals: { totalBytes: collected.totalBytes, totalLines: collected.totalLines },
  };
}
