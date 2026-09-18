/**
 * Pure policy for the session image payload eject.
 *
 * Three decisions live here: what to replace at insert time, what to re-attach at request time, and
 * which cache entries are stale after compaction or tree navigation. Every function is pure, so the
 * rules are testable without a Pi runtime. `session.ts` owns the state and `index.ts` owns the Pi
 * hooks.
 */

import { createHash } from "node:crypto";

import type { ContextEvent, resizeImage, ToolResultEvent } from "@earendil-works/pi-coding-agent";

import type { CachedImage } from "./cache.ts";
import type { SessionPolicyConfig } from "./config.ts";
import { buildMarkerText, parseMarkerText } from "./marker.ts";

export type ToolResultContent = ToolResultEvent["content"];
export type ResultBlock = ToolResultContent[number];
export type ResizeImage = typeof resizeImage;
export type ContextMessages = ContextEvent["messages"];
export type ContextMessage = ContextMessages[number];
export type ImageLookup = (hash: string) => CachedImage | undefined;

export type CapturedImage = {
  hash: string;
  data: string;
  mimeType: string;
  chars: number;
};

export type InsertOutcome = {
  content: ToolResultContent;
  captured: readonly CapturedImage[];
  changed: boolean;
};

export type ContextOutcome = {
  messages: ContextMessages;
  /** Images put back after their marker. */
  reattached: number;
  /** Live markers whose hash is not cached. */
  missing: number;
  /** Markers found in the live messages. */
  liveMarkers: number;
  changed: boolean;
};

/** sha256 of a base64 payload. This is the cache key and the value stored in the marker. */
export function payloadHash(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

type Prepared = {
  marker: string;
  captured: CapturedImage;
};

async function prepareImage(
  block: Extract<ResultBlock, { type: "image" }>,
  config: SessionPolicyConfig,
  resize: ResizeImage,
  source: string | undefined,
): Promise<Prepared> {
  let data = block.data;
  let mimeType = block.mimeType;
  if (data.length > config.maxImageBytes) {
    const resized = await resize(Buffer.from(data, "base64"), mimeType, {
      maxWidth: config.maxImageWidth,
      maxHeight: config.maxImageHeight,
      maxBytes: config.maxImageBytes,
    });
    if (resized !== null) {
      data = resized.data;
      mimeType = resized.mimeType;
    }
  }
  const chars = data.length;
  const hash = payloadHash(data);
  return {
    marker: buildMarkerText({ hash, mimeType, chars, source }),
    captured: { hash, data, mimeType, chars },
  };
}

export async function applyInsertPolicy(
  content: ToolResultContent,
  config: SessionPolicyConfig,
  resize: ResizeImage,
  source: string | undefined,
): Promise<InsertOutcome> {
  const captured: CapturedImage[] = [];
  const replaced: ResultBlock[] = [];
  for (const block of content) {
    if (block.type !== "image") {
      replaced.push(block);
      continue;
    }
    const prepared = await prepareImage(block, config, resize, source);
    replaced.push({ type: "text", text: prepared.marker });
    captured.push(prepared.captured);
  }
  const changed = captured.length > 0;
  return { content: changed ? replaced : content, captured, changed };
}

type ReattachOutcome = {
  blocks: ResultBlock[];
  reattached: number;
  missing: number;
  liveMarkers: number;
};

/** A marker that already has its picture after it is left alone. */
function alreadyAttached(content: ToolResultContent, index: number): boolean {
  return content[index + 1]?.type === "image";
}

function reattachContent(content: ToolResultContent, lookup: ImageLookup): ReattachOutcome {
  const blocks: ResultBlock[] = [];
  let reattached = 0;
  let missing = 0;
  let liveMarkers = 0;
  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    if (block === undefined) continue;
    const marker = block.type === "text" ? parseMarkerText(block.text) : undefined;
    if (marker === undefined) {
      blocks.push(block);
      continue;
    }
    liveMarkers += 1;
    blocks.push(block);
    if (alreadyAttached(content, index)) continue;
    const cached = lookup(marker.hash);
    if (cached === undefined) {
      missing += 1;
      continue;
    }
    blocks.push({ type: "image", data: cached.data, mimeType: cached.mimeType });
    reattached += 1;
  }
  return { blocks, reattached, missing, liveMarkers };
}

export function applyContextPolicy(messages: ContextMessages, lookup: ImageLookup): ContextOutcome {
  const updated: ContextMessages = [];
  let reattached = 0;
  let missing = 0;
  let liveMarkers = 0;
  for (const message of messages) {
    if (message.role !== "toolResult") {
      updated.push(message);
      continue;
    }
    const outcome = reattachContent(message.content, lookup);
    liveMarkers += outcome.liveMarkers;
    missing += outcome.missing;
    if (outcome.reattached === 0) {
      updated.push(message);
      continue;
    }
    reattached += outcome.reattached;
    updated.push({ ...message, content: outcome.blocks });
  }
  return {
    messages: reattached > 0 ? updated : messages,
    reattached,
    missing,
    liveMarkers,
    changed: reattached > 0,
  };
}

function markerHashes(content: ToolResultContent): string[] {
  const hashes: string[] = [];
  for (const block of content) {
    if (block.type !== "text") continue;
    const marker = parseMarkerText(block.text);
    if (marker !== undefined) hashes.push(marker.hash);
  }
  return hashes;
}

/**
 * Hashes of every marker in the live messages. This is the live set the prune step keeps, so a hash
 * that is absent here is ejected from the cache.
 */
export function collectMarkerHashes(messages: ContextMessages): Set<string> {
  const hashes = new Set<string>();
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    for (const hash of markerHashes(message.content)) hashes.add(hash);
  }
  return hashes;
}
