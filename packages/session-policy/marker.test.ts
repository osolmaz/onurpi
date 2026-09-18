import { describe, expect, it } from "vitest";

import { buildMarkerText, MARKER_PATTERN, parseMarkerText, type Marker } from "./marker.ts";

const HASH = "a".repeat(64);

const LIVE_SENTENCE =
  "This picture is attached while this result is in the live context. After compaction its bytes are gone.";
const REREAD_SENTENCE = "Re-read the source path to see it again.";

function marker(overrides: Partial<Marker> = {}): Marker {
  return {
    hash: HASH,
    mimeType: "image/png",
    chars: 612340,
    source: "/tmp/shot.png",
    ...overrides,
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

describe("buildMarkerText", () => {
  it("writes a parseable first line and the live sentence", () => {
    const text = buildMarkerText(marker());
    expect(firstLine(text)).toBe(
      `[image-eject sha256=${HASH} mime=image/png chars=612340 source=/tmp/shot.png]`,
    );
    expect(text).toBe(`${firstLine(text)}\n${LIVE_SENTENCE} ${REREAD_SENTENCE}`);
  });

  it("omits the source field and the re-read sentence when the tool had no path", () => {
    const text = buildMarkerText(marker({ source: undefined }));
    expect(firstLine(text)).toBe(`[image-eject sha256=${HASH} mime=image/png chars=612340]`);
    expect(text).not.toContain("source=");
    expect(text).not.toContain("Re-read");
  });

  it("keeps a source path with spaces on one line", () => {
    const text = buildMarkerText(marker({ source: "/tmp/two words and more.png" }));
    expect(parseMarkerText(text)?.source).toBe("/tmp/two words and more.png");
  });

  it("flattens a source path that holds a newline", () => {
    const text = buildMarkerText(marker({ source: "/tmp/odd\npath.png" }));
    expect(text.split("\n")).toHaveLength(2);
    expect(parseMarkerText(text)?.source).toBe("/tmp/odd path.png");
  });
});

describe("parseMarkerText", () => {
  it("round-trips a marker with a source", () => {
    expect(parseMarkerText(buildMarkerText(marker()))).toEqual(marker());
  });

  it("round-trips a marker without a source", () => {
    expect(parseMarkerText(buildMarkerText(marker({ source: undefined })))).toEqual(
      marker({ source: undefined }),
    );
  });

  it("reads the first line only", () => {
    const text = `${buildMarkerText(marker())}\ntrailing text`;
    expect(parseMarkerText(text)?.hash).toBe(HASH);
  });

  it("rejects text that is not a marker", () => {
    expect(parseMarkerText("plain text")).toBeUndefined();
    expect(parseMarkerText("")).toBeUndefined();
    expect(parseMarkerText("[image redacted: session image budget]")).toBeUndefined();
    expect(parseMarkerText("[image-eject sha256=abc mime=image/png chars=1]")).toBeUndefined();
    expect(
      parseMarkerText(`[image-eject sha256=${HASH} mime=image/png chars=many]`),
    ).toBeUndefined();
    expect(parseMarkerText(`image-eject sha256=${HASH} mime=image/png chars=1]`)).toBeUndefined();
    expect(
      parseMarkerText(`[image-eject sha256=${HASH} mime=image/png chars=1] extra`),
    ).toBeUndefined();
  });

  it("exposes the documented pattern", () => {
    expect(MARKER_PATTERN.test(firstLine(buildMarkerText(marker())))).toBe(true);
    expect(MARKER_PATTERN.test(firstLine(buildMarkerText(marker({ source: undefined }))))).toBe(
      true,
    );
  });
});
