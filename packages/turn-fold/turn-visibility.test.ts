import { expect, it } from "vitest";

import { TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import { TurnFoldState } from "./turn-state.ts";
import { projectedUserGroupIds } from "./turn-visibility.ts";

function assistantMessage(timestamp: number, text: string): Record<string, unknown> {
  return {
    content: [{ text, type: "text" }],
    provider: "test",
    role: "assistant",
    timestamp,
  };
}

it("keeps custom-prompt runs visible when their projected entries are displayed", () => {
  const state = new TurnFoldState();
  const assistant = {};
  const assistantHistory = assistantMessage(110, "Goal continuation");
  const entries = [
    {
      content: "Continue the active goal.",
      customType: "pi-goal-event",
      details: { kind: "continuation" },
      display: true,
      id: "goal-prompt",
      type: "custom_message",
    },
    { id: "goal-answer", message: assistantHistory, type: "message" },
    {
      customType: TURN_FOLD_RUN_ENTRY,
      data: {
        promptEntryId: "goal-prompt",
        runId: "goal-run",
        startedAt: 100,
        version: 1,
      },
      id: "goal-boundary",
      type: "custom",
    },
  ];

  state.applyHistoryProjection(entries, entries);
  state.associateAssistant(assistant, assistantHistory);

  expect(state.viewFor(assistant)?.display).not.toBe("hidden");
});

it("does not make a group visible from pass-through metadata alone", () => {
  const state = new TurnFoldState();
  const assistant = {};
  const assistantHistory = assistantMessage(110, "Answer");
  const entries = [
    { id: "user", message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message" },
    { id: "answer", message: assistantHistory, type: "message" },
    { id: "metadata", label: "checkpoint", type: "label" },
  ];

  state.applyHistoryProjection(entries, [entries[2]]);
  state.associateAssistant(assistant, assistantHistory);

  expect(state.viewFor(assistant)?.display).toBe("hidden");
});

it("derives the user cursor only from projected user entries", () => {
  const entries = [
    { id: "user-1", message: { content: "Same", role: "user", timestamp: 100 }, type: "message" },
    {
      content: "Status",
      customType: "workflow-status",
      display: true,
      id: "status-1",
      type: "custom_message",
    },
    { id: "user-2", message: { content: "Same", role: "user", timestamp: 200 }, type: "message" },
  ];
  const groupByEntryId = new Map([
    ["user-1", "group-1"],
    ["status-1", "group-1"],
    ["user-2", "group-2"],
  ]);

  expect(projectedUserGroupIds([entries[1], entries[2]], groupByEntryId)).toEqual(["group-2"]);
});

it("does not let a projected custom row shift a later user timestamp", () => {
  const state = new TurnFoldState();
  const visibleUser = {};
  const secondAssistant = assistantMessage(210, "Second answer");
  const entries = [
    { id: "user-1", message: { content: "First", role: "user", timestamp: 100 }, type: "message" },
    {
      content: "Status",
      customType: "workflow-status",
      display: true,
      id: "status-1",
      type: "custom_message",
    },
    { id: "user-2", message: { content: "Second", role: "user", timestamp: 200 }, type: "message" },
    { id: "answer-2", message: secondAssistant, type: "message" },
  ];

  state.applyHistoryProjection(entries, [entries[1], entries[2], entries[3]]);
  state.associateUser(visibleUser);

  expect(state.userTimestampFor(visibleUser)).toBe(200);
});

it("keeps post-compaction output visible when a boundary splits a run", () => {
  const state = new TurnFoldState();
  const postCompactionComponent = {};
  const before = assistantMessage(110, "Before compaction");
  const after = assistantMessage(170, "After compaction");
  const entries = [
    { id: "prompt", message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message" },
    { id: "before", message: before, type: "message" },
    {
      id: "boundary",
      summary: "Summary",
      timestamp: new Date(160).toISOString(),
      type: "compaction",
    },
    { id: "after", message: after, type: "message" },
  ];

  state.applyHistoryProjection(entries, entries.slice(2));
  state.associateAssistant(postCompactionComponent, after);

  expect(state.viewFor(postCompactionComponent)?.display).not.toBe("hidden");
});

it("keeps a retained automatic compaction visible when its preceding run is hidden", () => {
  const state = new TurnFoldState();
  const compaction = {};
  const firstAssistant = assistantMessage(110, "Before compaction");
  const entries = [
    { id: "before", message: { content: "Before", role: "user", timestamp: 100 }, type: "message" },
    { id: "answer", message: firstAssistant, type: "message" },
    {
      id: "boundary",
      summary: "Summary",
      timestamp: new Date(160).toISOString(),
      type: "compaction",
    },
    { id: "after", message: { content: "After", role: "user", timestamp: 200 }, type: "message" },
  ];
  const associations = new Map([
    [
      "boundary",
      {
        compactionEntryId: "boundary",
        timestamp: 160,
        turnEntryIds: ["before", "answer"],
        turnStartedAt: 100,
      },
    ],
  ]);

  state.applyHistoryProjection(entries, entries.slice(2), associations);
  state.associateCompaction(compaction, { timestamp: 160 });

  expect(state.compactionVisibleFor(compaction)).toBe(true);
  expect(state.viewFor(compaction)?.display).toBe("original");
});

it("hides standalone compactions by entry identity when timestamps collide", () => {
  const state = new TurnFoldState();
  const olderComponent = {};
  const newerComponent = {};
  const entries = [
    { id: "older", summary: "Older", timestamp: new Date(100).toISOString(), type: "compaction" },
    { id: "newer", summary: "Newer", timestamp: new Date(100).toISOString(), type: "compaction" },
  ];

  state.applyHistoryProjection(entries, entries.slice(1));
  state.associateCompaction(olderComponent, { timestamp: 100 });
  state.associateCompaction(newerComponent, { timestamp: 100 });

  expect(state.compactionVisibleFor(olderComponent)).toBe(false);
  expect(state.compactionVisibleFor(newerComponent)).toBe(true);

  state.applyDisplayProjection(entries);
  expect(state.compactionVisibleFor(olderComponent)).toBe(true);
});

it("hides and restores loaded groups without rebuilding component associations", () => {
  const state = new TurnFoldState();
  const firstUser = {};
  const firstAssistant = {};
  const secondUser = {};
  const secondAssistant = {};
  const firstMessage = assistantMessage(110, "First");
  const secondMessage = assistantMessage(210, "Second");
  const entries = [
    { id: "u1", message: { content: "first", role: "user", timestamp: 100 }, type: "message" },
    { id: "a1", message: firstMessage, type: "message" },
    { id: "u2", message: { content: "second", role: "user", timestamp: 200 }, type: "message" },
    { id: "a2", message: secondMessage, type: "message" },
  ];

  state.applyHistoryProjection(entries, entries);
  state.associateUser(firstUser);
  state.associateAssistant(firstAssistant, firstMessage);
  state.associateUser(secondUser);
  state.associateAssistant(secondAssistant, secondMessage);
  state.applyDisplayProjection(entries.slice(2));

  expect(state.userVisibleFor(firstUser)).toBe(false);
  expect(state.viewFor(firstAssistant)?.display).toBe("hidden");
  expect(state.userVisibleFor(secondUser)).toBe(true);
  expect(state.viewFor(secondAssistant)?.display).not.toBe("hidden");

  state.applyDisplayProjection(entries);
  expect(state.userVisibleFor(firstUser)).toBe(true);
  expect(state.viewFor(firstAssistant)?.display).not.toBe("hidden");
});
