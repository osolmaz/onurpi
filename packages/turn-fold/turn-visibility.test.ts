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
