import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordBridge, TYPING_INTERVAL_MS } from "../src/bridge.ts";
import { parseAdapterConfig } from "../src/config.ts";
import type { AgentReply } from "../src/types.ts";
import {
  CHANNEL,
  FakeAgent,
  FakeLedger,
  FakeTransport,
  message,
  oneChannel,
  STRANGER,
} from "./helpers.ts";

const config = parseAdapterConfig(oneChannel());

function setup(
  agent = new FakeAgent(),
  ledger = new FakeLedger(),
  transport = new FakeTransport(),
) {
  const events: string[] = [];
  const bridge = new DiscordBridge({
    agent,
    config,
    ledger,
    log: (event) => events.push(event),
    transport,
  });
  bridge.start();
  return { agent, bridge, events, ledger, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DiscordBridge", () => {
  it("shows typing, then replies to the message with the answer", async () => {
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

  it("keeps typing while the agent works and stops when it answers", async () => {
    vi.useFakeTimers();
    let answer: (reply: AgentReply) => void = () => undefined;
    const agent = new FakeAgent();
    agent.ask = () => new Promise((resolve) => (answer = resolve));
    const { bridge, transport } = setup(agent);
    transport.emit(message());
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 3);
    expect(transport.typing).toHaveLength(4);

    answer({ kind: "answer", text: "done" });
    await bridge.idle();
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 3);
    expect(transport.typing).toHaveLength(4);
    expect(transport.posted.map((item) => item.text)).toEqual(["done"]);
  });

  it("posts the rest of a long answer as more messages", async () => {
    const long = "word ".repeat(1200);
    const { bridge, transport } = setup(new FakeAgent(() => ({ kind: "answer", text: long })));
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted.length).toBeGreaterThan(1);
    expect(transport.posted[0]?.replyTo).toBe("600000000000000006");
    expect(transport.posted[1]?.replyTo).toBeUndefined();
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

  it("tells the owner when the agent throws, and logs the error", async () => {
    const agent = new FakeAgent();
    agent.ask = () => Promise.reject(new Error("storage is gone"));
    const { bridge, events, transport } = setup(agent);
    transport.emit(message());
    await bridge.idle();

    expect(events).toEqual(["accepted", "agent_failed", "answered"]);
    expect(transport.posted[0]?.text).toBe(
      "Sorry, I could not answer: the agent stopped with an error",
    );
  });

  it("still answers when Discord refuses the typing indicator", async () => {
    const { bridge, events, transport } = setup();
    transport.startTyping = () => Promise.reject(new Error("rate limited"));
    transport.emit(message());
    await bridge.idle();

    expect(events).toEqual(["accepted", "typing_failed", "answered"]);
    expect(transport.posted[0]?.text).toBe("Echo: hello");
  });

  it("logs a reply that Discord refuses, without stopping", async () => {
    const { bridge, events, transport } = setup();
    transport.send = () => Promise.reject(new Error("missing permissions"));
    transport.emit(message());
    await bridge.idle();

    expect(events).toEqual(["accepted", "reply_failed"]);
  });

  it("ignores messages it should not answer", async () => {
    const { agent, bridge, transport } = setup();
    transport.emit(message({ authorId: STRANGER }));
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.typing).toEqual([]);
    expect(transport.posted).toEqual([]);
  });

  it("records every message it sees, also the ones it ignores", async () => {
    const { bridge, ledger, transport } = setup();
    transport.emit(message({ authorId: STRANGER, id: "600000000000000009" }));
    await bridge.idle();

    expect(await ledger.positions()).toEqual({ [CHANNEL]: "600000000000000009" });
    expect(await ledger.pending()).toEqual([]);
  });
});

describe("DiscordBridge after a restart", () => {
  it("answers a message that an earlier process accepted but did not answer", async () => {
    const ledger = new FakeLedger();
    await ledger.accept(message());
    const { bridge, events, transport } = setup(new FakeAgent(), ledger);
    await bridge.idle();

    expect(transport.posted.map((item) => item.text)).toEqual(["Echo: hello"]);
    expect(await ledger.pending()).toEqual([]);
    expect(events).toEqual(["resumed", "answered"]);
  });

  it("does not reply twice when the earlier process already replied", async () => {
    const ledger = new FakeLedger();
    await ledger.accept(message());
    const transport = new FakeTransport();
    await transport.send(CHANNEL, "Echo: hello", "600000000000000006");
    const { agent, bridge } = setup(new FakeAgent(), ledger, transport);
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.posted).toHaveLength(1);
    expect(await ledger.pending()).toEqual([]);
  });

  it("drops a waiting message that the configuration no longer accepts", async () => {
    const ledger = new FakeLedger();
    await ledger.accept(message({ authorId: STRANGER }));
    const { agent, bridge } = setup(new FakeAgent(), ledger);
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(await ledger.pending()).toEqual([]);
  });

  it("answers the messages that arrived while no process ran, and only those", async () => {
    const ledger = new FakeLedger();
    await ledger.seen(CHANNEL, "600000000000000006");
    const transport = new FakeTransport();
    transport.history.push(
      message({ content: "old", id: "600000000000000005" }),
      message({ content: "missed one", id: "600000000000000007" }),
      message({ content: "missed two", id: "600000000000000008" }),
    );
    const { agent, bridge } = setup(new FakeAgent(), ledger, transport);
    await bridge.idle();

    expect(agent.requests.map((request) => request.text)).toEqual(["missed one", "missed two"]);
    expect(await ledger.positions()).toEqual({ [CHANNEL]: "600000000000000008" });
  });

  it("logs a channel it cannot read and goes on", async () => {
    const ledger = new FakeLedger();
    await ledger.seen(CHANNEL, "600000000000000006");
    const transport = new FakeTransport();
    transport.fetchAfter = () => Promise.reject(new Error("missing access"));
    const { bridge, events } = setup(new FakeAgent(), ledger, transport);
    await bridge.idle();

    expect(events).toEqual(["catch_up_failed"]);
  });
});
