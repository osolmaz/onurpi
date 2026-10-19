import { describe, expect, it } from "vitest";

import { createCommandHandler } from "../src/commands.ts";
import type { WorkerConfig } from "../src/config.ts";

type Agent = Pick<import("../src/agent.ts").RunningAgent, "reset" | "abort" | "inspect">;

function fakeAgent(): Agent & { resetCalls: string[]; abortCalls: string[] } {
  const resetCalls: string[] = [];
  const abortCalls: string[] = [];
  return {
    abortCalls,
    abort: (key: string) => {
      abortCalls.push(key);
      return Promise.resolve();
    },
    inspect: () => Promise.resolve({ entries: 4, messages: 3 }),
    resetCalls,
    reset: (key: string, handoff?: string) => {
      resetCalls.push(`${key}:${handoff ?? ""}`);
      return Promise.resolve();
    },
  };
}

const config = {
  model: { provider: "openai-codex", modelId: "gpt-6.1-sol" },
  workspace: "/workspace",
} as unknown as WorkerConfig;

describe("commands", () => {
  it("resets the session, queueing a handoff message when one is given", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    const answer = await handler({ channelId: "400000000000000004" }, "/new start fresh", false);
    expect(answer).toBe("New session; your message is its first.");
    expect(agent.resetCalls).toEqual(["discord:400000000000000004:start fresh"]);
  });

  it("tells the truth about a reset that waits for the running turn", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    const answer = await handler({ channelId: "400000000000000004" }, "/new", true);
    expect(agent.resetCalls).toEqual(["discord:400000000000000004:"]);
    expect(answer).toBe("New session queued; it starts when the current turn finishes.");
  });

  it("aborts the running turn on /stop", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    const answer = await handler({ channelId: "400000000000000004" }, "/stop", true);
    expect(answer).toBe("Stopped; the answer so far stays in the transcript.");
    expect(agent.abortCalls).toEqual(["discord:400000000000000004"]);
  });

  it("reports the model, the run state, and the transcript's size on /status", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    expect(await handler({ channelId: "400000000000000004" }, "/status", true)).toBe(
      "model: openai-codex/gpt-6.1-sol\nstate: working\ncontext: 3 messages (4 entries)",
    );
    expect(await handler({ channelId: "400000000000000004" }, "/model", false)).toBe(
      "openai-codex/gpt-6.1-sol",
    );
    expect(await handler({ channelId: "400000000000000004" }, "/context", false)).toBe(
      "3 model messages over 4 transcript entries.",
    );
  });

  it("aborts the running turn on /stop and says when nothing is running", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    expect(await handler({ channelId: "400000000000000004" }, "/stop", true)).toBe(
      "Stopped; the answer so far stays in the transcript.",
    );
    expect(await handler({ channelId: "400000000000000004" }, "/stop", false)).toBe(
      "Nothing is running.",
    );
    expect(agent.abortCalls).toEqual(["discord:400000000000000004", "discord:400000000000000004"]);
  });

  it("lists the commands, the model, and the pi runtime on /help", async () => {
    const handler = createCommandHandler({ agent: fakeAgent(), config });
    const help = await handler({ channelId: "400000000000000004" }, "/help", false);
    expect(help).toContain("/new [message]");
    expect(help).toContain("/stop");
    expect(help).toContain("openai-codex/gpt-6.1-sol");
    expect(help).toMatch(/pi-durable( \d+\.\d+\.\d+)?/);
  });

  it("returns undefined for an unknown word, so the message flows on to the agent", async () => {
    const agent = fakeAgent();
    const handler = createCommandHandler({ agent, config });
    expect(await handler({ channelId: "400000000000000004" }, "/frobnicate now", false)).toBe(
      undefined,
    );
    expect(await handler({ channelId: "400000000000000004" }, "just talking", false)).toBe(
      undefined,
    );
    expect(agent.resetCalls).toEqual([]);
    expect(agent.abortCalls).toEqual([]);
  });
});
