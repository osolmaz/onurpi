import { describe, expect, it } from "vitest";

import {
  branchEntryIds,
  historicalRunStarts,
  nearestRunStartIndex,
  parseRunBoundary,
  promptEntryIdAfter,
  runBoundaryFromEntry,
  RunBoundaryRecorder,
  TURN_FOLD_RUN_ENTRY,
  type RunBoundary,
} from "./run-boundary.ts";

function message(id: string, role: string): unknown {
  return { id, message: { role }, type: "message" };
}

function customMessage(id: string): unknown {
  return { content: "Continue", customType: "goal", display: true, id, type: "custom_message" };
}

function marker(id: string, data: RunBoundary): Record<string, unknown> {
  return { customType: TURN_FOLD_RUN_ENTRY, data, id, type: "custom" };
}

function boundary(promptEntryId: string | null = "prompt"): RunBoundary {
  return { promptEntryId, runId: "run-1", startedAt: 100, version: 1 };
}

describe("Turn Fold run boundary schema", () => {
  it("parses the exact durable shape", () => {
    expect(parseRunBoundary(boundary())).toEqual(boundary());
    expect(parseRunBoundary(boundary(null))).toEqual(boundary(null));
    expect(parseRunBoundary({ ...boundary(), extra: true })).toBeUndefined();
    expect(parseRunBoundary({ ...boundary(), runId: "" })).toBeUndefined();
    expect(parseRunBoundary({ ...boundary(), promptEntryId: 1 })).toBeUndefined();
    expect(parseRunBoundary({ ...boundary(), startedAt: Number.NaN })).toBeUndefined();
    expect(parseRunBoundary({ ...boundary(), startedAt: -1 })).toBeUndefined();
    expect(parseRunBoundary({ ...boundary(), version: 2 })).toBeUndefined();
  });

  it("reads only matching custom entries", () => {
    expect(runBoundaryFromEntry(marker("marker", boundary()))).toEqual(boundary());
    expect(
      runBoundaryFromEntry({ ...marker("marker", boundary()), customType: "other" }),
    ).toBeUndefined();
    expect(runBoundaryFromEntry(message("prompt", "user"))).toBeUndefined();
  });
});

describe("Turn Fold run boundary indexing", () => {
  it("finds a newly persisted user or custom prompt", () => {
    const existing = new Set(["old"]);
    expect(
      promptEntryIdAfter(
        [message("old", "assistant"), customMessage("prompt"), message("answer", "assistant")],
        existing,
      ),
    ).toBe("prompt");
    expect(promptEntryIdAfter([message("old", "assistant")], existing)).toBeNull();
  });

  it("indexes markers at their prompt or at themselves when the prompt is absent", () => {
    const present = [
      customMessage("prompt"),
      marker("marker", boundary("prompt")),
      message("answer", "assistant"),
    ];
    expect(historicalRunStarts(present).get("prompt")).toEqual(boundary("prompt"));

    const missing = [marker("marker", boundary("missing")), message("answer", "assistant")];
    expect(historicalRunStarts(missing).get("marker")).toEqual(boundary("missing"));
  });

  it("selects the nearest marker anchor before a compaction", () => {
    const entries = [
      message("user", "user"),
      message("old", "assistant"),
      customMessage("prompt"),
      message("answer", "assistant"),
      marker("marker", boundary("prompt")),
      { id: "compaction", type: "compaction" },
    ];
    expect(nearestRunStartIndex(entries, 5)).toBe(2);
    expect(nearestRunStartIndex([message("user", "user"), message("answer", "assistant")], 2)).toBe(
      0,
    );
    expect(nearestRunStartIndex([message("answer", "assistant")], 1)).toBeUndefined();
  });

  it("collects existing branch IDs", () => {
    expect(branchEntryIds([message("one", "user"), { type: "custom" }])).toEqual(new Set(["one"]));
  });

  it("records one boundary per start and resets pending state", () => {
    const appended: { customType: string; data: RunBoundary }[] = [];
    const recorder = new RunBoundaryRecorder((customType, data) => {
      appended.push({ customType, data });
    });
    recorder.start([message("old", "assistant")], 100, "run-1");
    recorder.start([], 200, "duplicate");
    expect(recorder.persist([message("old", "assistant"), customMessage("prompt")])).toEqual(
      boundary("prompt"),
    );
    expect(appended).toEqual([{ customType: TURN_FOLD_RUN_ENTRY, data: boundary("prompt") }]);
    expect(recorder.persist([])).toBeUndefined();
    recorder.start([], 300, "run-2");
    recorder.reset();
    expect(recorder.persist([])).toBeUndefined();

    const promptAtStart = new RunBoundaryRecorder((customType, data) => {
      appended.push({ customType, data });
    });
    promptAtStart.start([customMessage("existing-prompt")], 400, "run-3");
    expect(
      promptAtStart.persist([customMessage("existing-prompt"), message("answer", "assistant")]),
    ).toMatchObject({ promptEntryId: "existing-prompt", runId: "run-3" });
  });
});
