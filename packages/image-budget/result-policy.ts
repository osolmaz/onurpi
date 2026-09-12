/**
 * Insert-time policy for images returned by tools.
 *
 * Runs on the `tool_result` hook, before a result becomes a session entry. It keeps the newest
 * images of a result, re-encodes images over the per-image budget, and replaces anything it cannot
 * keep with a text note so the model knows what happened.
 */

import type { resizeImage, ToolResultEvent } from "@earendil-works/pi-coding-agent";

import {
  type ImageBudgetConfig,
  type ResultOutcome,
  omittedNote,
  resizeFailureNote,
} from "./image-budget.ts";

export type ToolResultContent = ToolResultEvent["content"];
export type ResultBlock = ToolResultContent[number];
export type ResizeImage = typeof resizeImage;

export type ResultPolicy = {
  content: ToolResultContent;
  outcome: ResultOutcome;
};

type PreparedImage = {
  block: ResultBlock | undefined;
  note: string | undefined;
  saved: number;
  resized: boolean;
};

const NO_CHANGE: ResultOutcome = { omitted: 0, resized: 0, dropped: 0, bytesSaved: 0 };

function isImageBlock(block: ResultBlock): block is Extract<ResultBlock, { type: "image" }> {
  return block.type === "image";
}

async function prepareImage(
  block: Extract<ResultBlock, { type: "image" }>,
  config: ImageBudgetConfig,
  resize: ResizeImage,
): Promise<PreparedImage> {
  const bytes = block.data.length;
  const untouched: PreparedImage = {
    block,
    note: undefined,
    saved: 0,
    resized: false,
  };
  if (bytes <= config.maxImageBytes) return untouched;
  const result = await resize(Buffer.from(block.data, "base64"), block.mimeType, {
    maxWidth: config.maxImageWidth,
    maxHeight: config.maxImageHeight,
    maxBytes: config.maxImageBytes,
  });
  if (result === null) {
    return {
      block: undefined,
      note: resizeFailureNote(bytes, block.mimeType, config.maxImageBytes),
      saved: 0,
      resized: false,
    };
  }
  const unchanged = !result.wasResized && result.data === block.data;
  if (unchanged) return untouched;
  return {
    block: { type: "image", data: result.data, mimeType: result.mimeType },
    note: undefined,
    saved: bytes - result.data.length,
    resized: true,
  };
}

function noteBlock(text: string): ResultBlock {
  return { type: "text", text };
}

type Collected = {
  kept: ToolResultContent;
  notes: string[];
  outcome: ResultOutcome;
};

async function collectImages(
  content: ToolResultContent,
  config: ImageBudgetConfig,
  resize: ResizeImage,
): Promise<Collected> {
  const kept: ToolResultContent = [];
  const notes: string[] = [];
  let outcome: ResultOutcome = { ...NO_CHANGE };
  let imagesSeen = 0;
  for (const block of content) {
    if (!isImageBlock(block)) {
      kept.push(block);
      continue;
    }
    imagesSeen += 1;
    if (imagesSeen > config.maxImagesPerResult) {
      outcome = { ...outcome, omitted: outcome.omitted + 1 };
      continue;
    }
    const prepared = await prepareImage(block, config, resize);
    if (prepared.note !== undefined) notes.push(prepared.note);
    if (prepared.block !== undefined) kept.push(prepared.block);
    outcome = {
      omitted: outcome.omitted,
      resized: outcome.resized + (prepared.resized ? 1 : 0),
      dropped: outcome.dropped + (prepared.note === undefined ? 0 : 1),
      bytesSaved: outcome.bytesSaved + prepared.saved,
    };
  }
  return { kept, notes, outcome };
}

export async function applyResultPolicy(
  content: ToolResultContent,
  config: ImageBudgetConfig,
  resize: ResizeImage,
): Promise<ResultPolicy> {
  if (!config.enabled) return { content, outcome: NO_CHANGE };
  const collected = await collectImages(content, config, resize);
  const { outcome } = collected;
  const changed = outcome.omitted > 0 || outcome.resized > 0 || outcome.dropped > 0;
  if (!changed) return { content, outcome };
  if (outcome.omitted > 0) {
    collected.notes.push(omittedNote(outcome.omitted, config.maxImagesPerResult));
  }
  return { content: [...collected.kept, ...collected.notes.map(noteBlock)], outcome };
}
