import type { ResizedImage } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { CachedImage } from "./cache.ts";
import { DEFAULT_CONFIG, type SessionPolicyConfig } from "./config.ts";
import { buildMarkerText, parseMarkerText, type Marker } from "./marker.ts";
import {
  applyContextPolicy,
  applyInsertPolicy,
  collectMarkerHashes,
  payloadHash,
  type ContextMessages,
  type ResizeImage,
  type ToolResultContent,
} from "./policy.ts";

type ResizeOptions = NonNullable<Parameters<ResizeImage>[2]>;

function config(overrides: Partial<SessionPolicyConfig> = {}): SessionPolicyConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function image(data: string, mimeType = "image/png"): ToolResultContent[number] {
  return { type: "image", data, mimeType };
}

function text(value: string): ToolResultContent[number] {
  return { type: "text", text: value };
}

function toolResult(content: ToolResultContent): ContextMessages[number] {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content,
    isError: false,
    timestamp: 1,
  };
}

function markerFor(data: string, source: string | undefined, mimeType = "image/png"): Marker {
  return {
    hash: payloadHash(data),
    mimeType,
    chars: data.length,
    source,
  };
}

function markerAt(content: ToolResultContent, index: number): Marker {
  const block = content[index];
  if (block?.type !== "text") throw new Error(`no text block at ${String(index)}`);
  const marker = parseMarkerText(block.text);
  if (marker === undefined) throw new Error(`no marker at ${String(index)}`);
  return marker;
}

function cacheOf(entries: Record<string, CachedImage>): (hash: string) => CachedImage | undefined {
  return (hash) => entries[hash];
}

/** Content of the first message, which the re-attach cases expect to be a tool result. */
function resultContent(messages: ContextMessages): ToolResultContent {
  const message = messages[0];
  if (message?.role !== "toolResult") throw new Error("expected a tool result message");
  return message.content;
}

function cached(data: string, mimeType = "image/png"): CachedImage {
  return { data, mimeType };
}

const noResize: ResizeImage = () => Promise.resolve(null);

function resized(data: string, mimeType = "image/jpeg"): ResizedImage {
  return {
    data,
    mimeType,
    originalWidth: 4000,
    originalHeight: 3000,
    width: 1600,
    height: 1200,
    wasResized: true,
  };
}

describe("payloadHash", () => {
  it("hashes the base64 payload", () => {
    expect(payloadHash("aaaa")).toBe(
      "61be55a8e2f6b4e172338bddf184d6dbee29c98853e0a0485ecee7f27b9af0b4",
    );
    expect(payloadHash("aaaa")).toBe(payloadHash("aaaa"));
    expect(payloadHash("aaaa")).not.toBe(payloadHash("bbbb"));
  });
});

describe("applyInsertPolicy", () => {
  it("replaces each image with a marker and reports the captured payloads", async () => {
    const outcome = await applyInsertPolicy(
      [text("before"), image("aaaa"), image("bbbb")],
      config(),
      noResize,
      "/tmp/shot.png",
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.captured).toEqual([
      { hash: payloadHash("aaaa"), data: "aaaa", mimeType: "image/png", chars: 4 },
      { hash: payloadHash("bbbb"), data: "bbbb", mimeType: "image/png", chars: 4 },
    ]);
    expect(outcome.content[0]).toEqual(text("before"));
    expect(markerAt(outcome.content, 1)).toEqual(markerFor("aaaa", "/tmp/shot.png"));
    expect(markerAt(outcome.content, 2)).toEqual(markerFor("bbbb", "/tmp/shot.png"));
  });

  it("omits the source when the tool input has no path", async () => {
    const outcome = await applyInsertPolicy([image("aaaa")], config(), noResize, undefined);
    expect(markerAt(outcome.content, 0)).toEqual(markerFor("aaaa", undefined));
    const block = outcome.content[0];
    if (block?.type !== "text") throw new Error("expected a marker");
    expect(block.text).not.toContain("source=");
  });

  it("resizes an oversize image before caching it", async () => {
    const calls: ResizeOptions[] = [];
    const resize: ResizeImage = (_bytes, _mimeType, options) => {
      calls.push(options ?? {});
      return Promise.resolve(resized("small"));
    };
    const outcome = await applyInsertPolicy(
      [image("a".repeat(DEFAULT_CONFIG.maxImageBytes + 1))],
      config(),
      resize,
      undefined,
    );
    expect(calls).toEqual([
      { maxWidth: 1600, maxHeight: 1600, maxBytes: DEFAULT_CONFIG.maxImageBytes },
    ]);
    expect(outcome.captured[0]).toEqual({
      hash: payloadHash("small"),
      data: "small",
      mimeType: "image/jpeg",
      chars: 5,
    });
    expect(markerAt(outcome.content, 0)).toEqual(markerFor("small", undefined, "image/jpeg"));
    expect(markerAt(outcome.content, 0).mimeType).toBe("image/jpeg");
  });

  it("does not resize an image inside the limit", async () => {
    let calls = 0;
    const resize: ResizeImage = () => {
      calls += 1;
      return Promise.resolve(null);
    };
    const outcome = await applyInsertPolicy(
      [image("a".repeat(DEFAULT_CONFIG.maxImageBytes))],
      config(),
      resize,
      undefined,
    );
    expect(calls).toBe(0);
    expect(outcome.captured[0]?.chars).toBe(DEFAULT_CONFIG.maxImageBytes);
  });

  it("keeps the original payload when the resize fails", async () => {
    const outcome = await applyInsertPolicy(
      [image("a".repeat(1024))],
      config({ maxImageBytes: 8 }),
      noResize,
      undefined,
    );
    expect(outcome.captured[0]?.chars).toBe(1024);
    expect(outcome.captured[0]?.hash).toBe(payloadHash("a".repeat(1024)));
  });

  it("returns a text-only result unchanged", async () => {
    const content = [text("nothing to eject")];
    const outcome = await applyInsertPolicy(content, config(), noResize, undefined);
    expect(outcome.changed).toBe(false);
    expect(outcome.content).toBe(content);
    expect(outcome.captured).toEqual([]);
  });

  it("returns a marker-only result unchanged", async () => {
    const content = [text(buildMarkerText(markerFor("aaaa", undefined)))];
    const outcome = await applyInsertPolicy(content, config(), noResize, undefined);
    expect(outcome.changed).toBe(false);
    expect(outcome.content).toBe(content);
  });
});

describe("applyContextPolicy", () => {
  it("re-attaches a cached picture after its marker without mutating the input", () => {
    const content: ToolResultContent = [text(buildMarkerText(markerFor("aaaa", "/tmp/a.png")))];
    const messages: ContextMessages = [toolResult(content)];
    const outcome = applyContextPolicy(
      messages,
      cacheOf({ [payloadHash("aaaa")]: cached("aaaa") }),
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.reattached).toBe(1);
    expect(outcome.missing).toBe(0);
    expect(outcome.liveMarkers).toBe(1);
    expect(resultContent(outcome.messages)).toEqual([...content, image("aaaa")]);
    expect(outcome.messages[0]).not.toBe(messages[0]);
    expect(content).toEqual([text(buildMarkerText(markerFor("aaaa", "/tmp/a.png")))]);
  });

  it("does not add a second picture when one is already there", () => {
    const content: ToolResultContent = [
      text(buildMarkerText(markerFor("aaaa", undefined))),
      image("aaaa"),
    ];
    const messages: ContextMessages = [toolResult(content)];
    const outcome = applyContextPolicy(
      messages,
      cacheOf({ [payloadHash("aaaa")]: cached("aaaa") }),
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reattached).toBe(0);
    expect(outcome.liveMarkers).toBe(1);
    expect(outcome.messages).toBe(messages);
  });

  it("passes a marker through when its hash is not cached", () => {
    const content: ToolResultContent = [text(buildMarkerText(markerFor("aaaa", undefined)))];
    const messages: ContextMessages = [toolResult(content)];
    const outcome = applyContextPolicy(messages, cacheOf({}));
    expect(outcome.changed).toBe(false);
    expect(outcome.missing).toBe(1);
    expect(outcome.reattached).toBe(0);
    expect(outcome.messages).toBe(messages);
  });

  it("leaves other messages alone", () => {
    const user: ContextMessages[number] = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    };
    const outcome = applyContextPolicy([user], cacheOf({}));
    expect(outcome.changed).toBe(false);
    expect(outcome.liveMarkers).toBe(0);
    expect(outcome.messages).toEqual([user]);
  });
  it("reports no change when there are no markers", () => {
    const messages: ContextMessages = [toolResult([text("plain result")])];
    const outcome = applyContextPolicy(messages, cacheOf({}));
    expect(outcome.changed).toBe(false);
    expect(outcome.messages).toBe(messages);
  });
});

describe("collectMarkerHashes", () => {
  it("collects the hashes of live markers only", () => {
    const messages: ContextMessages = [
      toolResult([
        text(buildMarkerText(markerFor("aaaa", undefined))),
        image("aaaa"),
        text("plain text"),
      ]),
      toolResult([text(buildMarkerText(markerFor("bbbb", undefined)))]),
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ];
    expect(collectMarkerHashes(messages)).toEqual(
      new Set([payloadHash("aaaa"), payloadHash("bbbb")]),
    );
  });

  it("returns an empty set without markers", () => {
    expect(collectMarkerHashes([toolResult([text("plain")])])).toEqual(new Set());
  });
});
