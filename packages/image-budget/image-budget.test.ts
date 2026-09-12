import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  type ImageBudgetConfig,
  type ImageRef,
  REDACTED_MARKER,
  formatBytes,
  omittedNote,
  planRedactions,
  redactionNote,
  redactionNotice,
  resizeFailureNote,
  resultOutcomeNotice,
  totalBytes,
} from "./image-budget.ts";

function config(overrides: Partial<ImageBudgetConfig> = {}): ImageBudgetConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("totalBytes", () => {
  it("sums sizes and treats an empty list as zero", () => {
    expect(totalBytes([])).toBe(0);
    expect(totalBytes([10, 20, 30])).toBe(60);
  });
});

describe("planRedactions", () => {
  it("keeps everything while the images fit the budget", () => {
    const plan = planRedactions([100, 100], config({ imageBudgetBytes: 1000 }));
    expect(plan.redactCount).toBe(0);
    expect(plan.bytesAfter).toBe(200);
    expect(plan.redactedBytes).toBe(0);
  });

  it("keeps everything when the extension is disabled", () => {
    const plan = planRedactions([5000], config({ enabled: false, imageBudgetBytes: 100 }));
    expect(plan).toEqual({ redactCount: 0, bytesBefore: 5000, bytesAfter: 5000, redactedBytes: 0 });
  });

  it("redacts the oldest images down to the low-water target", () => {
    const plan = planRedactions(
      [30, 30, 30, 30],
      config({ imageBudgetBytes: 100, redactToBytes: 40 }),
    );
    expect(plan.redactCount).toBe(3);
    expect(plan.bytesAfter).toBe(30);
    expect(plan.redactedBytes).toBe(90);
  });

  it("keeps the newest image when it alone fits the budget", () => {
    const plan = planRedactions([60, 60], config({ imageBudgetBytes: 100, redactToBytes: 40 }));
    expect(plan.redactCount).toBe(1);
    expect(plan.bytesAfter).toBe(60);
  });

  it("redacts a single oversized image", () => {
    const plan = planRedactions([200], config({ imageBudgetBytes: 100, redactToBytes: 40 }));
    expect(plan.redactCount).toBe(1);
    expect(plan.bytesAfter).toBe(0);
  });

  it("treats a low-water target above the budget as the budget", () => {
    const plan = planRedactions([80, 80], config({ imageBudgetBytes: 100, redactToBytes: 500 }));
    expect(plan.redactCount).toBe(1);
    expect(plan.bytesAfter).toBe(80);
  });
});

describe("formatBytes", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("notes", () => {
  const refs: ImageRef[] = [
    { bytes: 200_000, mimeType: "image/jpeg", toolName: "unified-exec" },
    { bytes: 100_000, mimeType: "image/jpeg", toolName: "unified-exec" },
  ];

  it("names the redacted bytes, the tools, and the kept images", () => {
    const note = redactionNote(refs, 5, 3670016);
    expect(note).toContain("2 images redacted by image-budget");
    expect(note).toContain("293 KB");
    expect(note).toContain("unified-exec");
    expect(note).toContain("5 images kept");
    expect(note).toContain("3.5 MB");
  });

  it("uses the singular form and marks unknown tools", () => {
    const note = redactionNote([{ bytes: 1000, mimeType: "image/png" }], 0, 1024);
    expect(note).toContain("1 image redacted");
    expect(note).toContain("unknown tool");
  });

  it("explains omitted and dropped images", () => {
    expect(omittedNote(1, 4)).toContain("1 image omitted");
    expect(omittedNote(2, 4)).toContain("2 images omitted");
    expect(omittedNote(2, 4)).toContain("at most 4 images");
    expect(resizeFailureNote(900_000, "image/png", 409600)).toContain("could not be re-encoded");
    expect(resizeFailureNote(900_000, "image/png", 409600)).toContain("879 KB");
    expect(REDACTED_MARKER).toContain("image redacted");
  });

  it("summarizes what a tool result policy did", () => {
    expect(
      resultOutcomeNotice({ omitted: 0, resized: 0, dropped: 0, bytesSaved: 0 }),
    ).toBeUndefined();
    expect(resultOutcomeNotice({ omitted: 2, resized: 1, dropped: 1, bytesSaved: 2048 })).toBe(
      "image-budget: re-encoded 1, omitted 2, dropped 1 images (2 KB saved)",
    );
    expect(resultOutcomeNotice({ omitted: 0, resized: 1, dropped: 0, bytesSaved: 1024 })).toBe(
      "image-budget: re-encoded 1 image (1 KB saved)",
    );
  });

  it("summarizes a redaction pass", () => {
    const notice = redactionNotice({
      redactCount: 3,
      bytesBefore: 4_000_000,
      bytesAfter: 2_000_000,
    });
    expect(notice).toContain("redacted 3 old images");
    expect(notice).toContain("3.8 MB -> 1.9 MB");
  });
});
