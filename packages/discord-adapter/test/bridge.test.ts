import { describe, expect, it } from "vitest";
import { DiscordBridge, WORKING_TEXT } from "../src/bridge.ts";
import { parseAdapterConfig } from "../src/config.ts";
import { CHANNEL, FakeAgent, FakeTransport, message, OWNER, STRANGER } from "./helpers.ts";

const config = parseAdapterConfig({ channelIds: [CHANNEL], ownerIds: [OWNER] });

function setup(agent = new FakeAgent()) {
  const transport = new FakeTransport();
  const events: string[] = [];
  const bridge = new DiscordBridge(transport, agent, config, (event) => events.push(event));
  bridge.start();
  return { agent, bridge, events, transport };
}

describe("DiscordBridge", () => {
  it("replies to the message with a placeholder and replaces it with the answer", async () => {
    const { agent, bridge, events, transport } = setup();
    transport.emit(message());
    await bridge.idle();

    expect(agent.requests).toEqual([
      {
        conversationKey: `discord:${CHANNEL}`,
        requestId: "discord:600000000000000006",
        text: "hello",
      },
    ]);
    expect(transport.typing).toEqual([CHANNEL]);
    expect(transport.posted).toEqual([
      { channelId: CHANNEL, id: "sent-1", replyTo: "600000000000000006", text: "Echo: hello" },
    ]);
    expect(events).toEqual(["accepted", "answered"]);
  });

  it("posts the rest of a long answer as more messages", async () => {
    const long = "word ".repeat(1200);
    const { bridge, transport } = setup(new FakeAgent(() => ({ kind: "answer", text: long })));
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted.length).toBeGreaterThan(1);
    expect(transport.posted.map((item) => item.text).join(" ")).toBe(long.trim());
  });

  it("tells the owner when the agent could not answer", async () => {
    const { bridge, transport } = setup(
      new FakeAgent(() => ({ kind: "failed", reason: "model_error" })),
    );
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted[0]?.text).toBe("Sorry, I could not answer: model_error");
  });

  it("ignores messages it should not answer", async () => {
    const { agent, bridge, transport } = setup();
    transport.emit(message({ authorId: STRANGER }));
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.posted).toEqual([]);
  });

  it("logs a failed reply without stopping", async () => {
    const agent = new FakeAgent();
    agent.ask = () => Promise.reject(new Error("storage is gone"));
    const { bridge, events, transport } = setup(agent);
    transport.emit(message());
    await bridge.idle();

    expect(events).toEqual(["accepted", "reply_failed"]);
    expect(transport.posted[0]?.text).toBe(WORKING_TEXT);
  });
});
