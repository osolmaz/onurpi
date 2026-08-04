import { expect, it } from "vitest";

import { TurnFoldState } from "./turn-state.ts";

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
  ];

  state.applyHistoryProjection(entries, entries);
  state.associateAssistant(assistant, assistantHistory);

  expect(state.viewFor(assistant)?.display).not.toBe("hidden");
});

it("does not make a group visible from non-rendering custom metadata alone", () => {
  const state = new TurnFoldState();
  const assistant = {};
  const assistantHistory = assistantMessage(110, "Answer");
  const entries = [
    { id: "user", message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message" },
    { id: "answer", message: assistantHistory, type: "message" },
    { customType: "metadata", data: {}, id: "metadata", type: "custom" },
  ];

  state.applyHistoryProjection(entries, [entries[2]]);
  state.associateAssistant(assistant, assistantHistory);

  expect(state.viewFor(assistant)?.display).toBe("hidden");
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
  state.applyDisplayProjection("compact", entries.slice(2));

  expect(state.userVisibleFor(firstUser)).toBe(false);
  expect(state.viewFor(firstAssistant)?.display).toBe("hidden");
  expect(state.userVisibleFor(secondUser)).toBe(true);
  expect(state.viewFor(secondAssistant)?.display).not.toBe("hidden");

  state.applyDisplayProjection("compact", entries);
  expect(state.userVisibleFor(firstUser)).toBe(true);
  expect(state.viewFor(firstAssistant)?.display).not.toBe("hidden");
});
