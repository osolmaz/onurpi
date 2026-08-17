import { describe, expect, it } from "vitest";

import { arrayValue, asRecord, numberValue } from "../src/load.js";
import { renderEntryJson, renderListJson, renderRecoveryJson } from "../src/render-json.js";
import { renderEntryText, renderListText, renderRecoveryText } from "../src/render-text.js";
import {
  OUTPUT_SCHEMA,
  TOTAL_OUTPUT_BYTES,
  type ControlEvent,
  type EntryDocument,
  type Excerpt,
  type RecoveryDocument,
  type SessionListDocument,
  type TurnEvidence,
} from "../src/types.js";

const timestamp = "2026-08-18T12:00:00.000Z";

function excerpt(text: string): Excerpt {
  const bytes = Buffer.byteLength(text);
  return {
    text,
    originalBytes: bytes,
    shownBytes: bytes,
    omittedBytes: 0,
    truncated: false,
    redactions: 0,
    omissions: [],
  };
}

function control(index: number): ControlEvent {
  return {
    entryId: `control-${String(index)}`,
    timestamp,
    kind: "workflow",
    toolName: "workflow",
    phase: "result",
    action: "update",
    text: excerpt(`control ${String(index)} ${"x".repeat(7_500)}`),
  };
}

function turn(index: number, controls: readonly ControlEvent[] = []): TurnEvidence {
  return {
    number: index,
    entryIds: [`user-${String(index)}`, `assistant-${String(index)}`],
    startedAt: timestamp,
    endedAt: timestamp,
    user: {
      entryId: `user-${String(index)}`,
      timestamp,
      text: excerpt(`user ${"u".repeat(1_900)}`),
    },
    assistant: {
      status: "complete",
      messages: [
        {
          entryId: `assistant-${String(index)}`,
          timestamp,
          kind: "final",
          text: excerpt(`assistant ${"a".repeat(1_900)}`),
        },
      ],
    },
    control: controls,
  };
}

function recovery(turns: readonly TurnEvidence[]): RecoveryDocument {
  return {
    schema: OUTPUT_SCHEMA,
    session: {
      id: "session-id",
      file: "/fixture/session.jsonl",
      cwd: "/fixture",
      version: 3,
      entries: turns.length * 2,
      activeBranchEntries: turns.length * 2,
    },
    integrity: {
      status: "issues",
      omittedIssues: 0,
      issues: Array.from({ length: 100 }, (_, index) => ({
        code: `issue-${String(index)}`,
        severity: "warning" as const,
        message: `integrity ${String(index)} ${"i".repeat(300)}`,
      })),
    },
    selection: {
      assistant: "final",
      include: ["workflow"],
      requestedLast: 20,
      since: null,
      totalTurns: turns.length,
      selectedTurns: turns.length,
      omittedTurns: 0,
      omittedControlEvents: 0,
      outputTruncated: false,
    },
    turns,
    nextOffset: null,
  };
}

describe("bounded renderers", () => {
  it("keeps recovery JSON valid while reporting omitted controls and issue details", () => {
    const document = recovery([
      turn(
        1,
        Array.from({ length: 8 }, (_, index) => control(index)),
      ),
    ]);
    const output = renderRecoveryJson(document);
    const parsed: unknown = JSON.parse(output) as unknown;
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    expect(parsed).toMatchObject({
      schema: OUTPUT_SCHEMA,
      integrity: { status: "issues" },
      selection: { outputTruncated: true },
    });
    const parsedRecord = asRecord(parsed);
    expect(numberValue(asRecord(parsedRecord?.["integrity"])?.["omittedIssues"])).toBeGreaterThan(
      0,
    );
    expect(
      numberValue(asRecord(parsedRecord?.["selection"])?.["omittedControlEvents"]),
    ).toBeGreaterThan(0);
  });

  it("bounds recovery text and marks omitted rendered evidence", () => {
    const document = recovery(Array.from({ length: 20 }, (_, index) => turn(index + 1)));
    const output = renderRecoveryText(document);
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    expect(output).toContain("[Output truncated:");
  });

  it("renders omitted and interrupted assistant states", () => {
    const omitted = turn(1);
    const interrupted: TurnEvidence = {
      ...turn(2),
      assistant: {
        status: "interrupted",
        messages: [
          {
            entryId: "progress",
            timestamp,
            kind: "intermediate",
            text: excerpt("progress evidence"),
          },
        ],
      },
    };
    const document = recovery([
      { ...omitted, assistant: { status: "omitted", messages: [] } },
      interrupted,
    ]);
    const output = renderRecoveryText({
      ...document,
      selection: { ...document.selection, assistant: "text" },
      integrity: { status: "ok", issues: [], omittedIssues: 0 },
    });
    expect(output).toContain("[Assistant output omitted by --assistant none]");
    expect(output).toContain("[intermediate]");
    expect(output).toContain("progress evidence");
    expect(output).toContain("turn was interrupted");
  });

  it("bounds list JSON and renders list text", () => {
    const document: SessionListDocument = {
      schema: OUTPUT_SCHEMA,
      scope: "all-projects",
      cwd: "/fixture",
      limit: 30,
      totalSessions: 30,
      omittedSessions: 0,
      sessions: Array.from({ length: 30 }, (_, index) => ({
        id: `session-${String(index)}`,
        path: `/fixture/${String(index)}.jsonl`,
        cwd: "/fixture",
        name: index === 0 ? null : `name-${String(index)}`,
        created: timestamp,
        modified: timestamp,
        messageCount: index,
        firstMessage: excerpt("m".repeat(1_900)),
      })),
    };
    const json = renderListJson(document);
    const parsed: unknown = JSON.parse(json) as unknown;
    const sessions = arrayValue(asRecord(parsed)?.["sessions"]);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    expect(sessions?.length).toBeLessThan(document.sessions.length);
    expect(numberValue(asRecord(parsed)?.["omittedSessions"])).toBeGreaterThan(0);
    const text = renderListText({ ...document, sessions: document.sessions.slice(0, 2) });
    expect(text).toContain("Scope: all-projects");
    expect(text).toContain("[unnamed]");
  });

  it("bounds entry issue details and renders found and missing entries", () => {
    const document: EntryDocument = {
      schema: OUTPUT_SCHEMA,
      session: {
        id: "session",
        file: "/fixture/session.jsonl",
        cwd: "/fixture",
        version: 3,
        entries: 1,
        activeBranchEntries: 1,
      },
      integrity: recovery([]).integrity,
      entry: {
        id: "entry",
        parentId: null,
        timestamp,
        type: "message",
        summary: excerpt("summary"),
      },
    };
    const json = renderEntryJson(document);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    const parsed: unknown = JSON.parse(json) as unknown;
    expect(parsed).toMatchObject({ integrity: { status: "issues" } });
    expect(
      numberValue(asRecord(asRecord(parsed)?.["integrity"])?.["omittedIssues"]),
    ).toBeGreaterThan(0);
    expect(renderEntryText(document)).toContain("Entry: entry");
    expect(renderEntryText({ ...document, entry: null })).toContain("Entry: not found");
  });
});
