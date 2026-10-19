import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordBridge, TYPING_INTERVAL_MS } from "../src/bridge.ts";
import { parseAdapterConfig } from "../src/config.ts";
import type { InboundAttachment } from "../src/types.ts";
import type { AgentReply } from "../src/types.ts";
import {
  BOT,
  CHANNEL,
  FakeAgent,
  FakeLedger,
  FakeTransport,
  GUILD,
  message,
  oneChannel,
  OTHER_CHANNEL,
  ProgressAgent,
  STRANGER,
} from "./helpers.ts";

const config = parseAdapterConfig(oneChannel());

/** The context line the bridge prepends to a run's first prompt for the test channel. */
const CONTEXT_TAG = `[discord: #general in Test Server, channel ${CHANNEL}]`;

/** The sender line the bridge prepends to every prompt from the test helper's message. */
const SENDER_TAG = "[from onur at 2026-10-19T12:40:00.000Z]";

/** The prompt the bridge builds for the helper's default message with the given text. */
const tagged = (text: string): string => `${CONTEXT_TAG}\n${SENDER_TAG}\n${text}`;

function setup(
  agent = new FakeAgent(),
  ledger = new FakeLedger(),
  transport = new FakeTransport(),
  overrides: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const events: string[] = [];
  const bridge = new DiscordBridge({
    agent,
    config: parseAdapterConfig({ ...oneChannel(), ...overrides }),
    ledger,
    log: (event) => events.push(event),
    transport,
    ...extra,
  });
  bridge.start();
  return { agent, bridge, events, ledger, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

it("saves attachments, names their paths in the prompt, and passes them to the agent", async () => {
  const { agent, bridge, transport } = setup(
    new FakeAgent(),
    new FakeLedger(),
    new FakeTransport(),
    {},
    {
      download: (attachment: InboundAttachment) =>
        Promise.resolve(`/workspace/attachments/${attachment.id}-${attachment.name}`),
    },
  );
  transport.emit(message({ attachments: [attachment()] }));
  await bridge.idle();

  expect(agent.requests[0]?.text).toContain(
    "photo.png saved at /workspace/attachments/a1-photo.png",
  );
  expect(agent.requests[0]?.attachments).toEqual([
    { contentType: "image/png", name: "photo.png", path: "/workspace/attachments/a1-photo.png" },
  ]);
});

it("notes but survives skipped and failed attachments", async () => {
  const { agent, bridge, transport } = setup(
    new FakeAgent(),
    new FakeLedger(),
    new FakeTransport(),
    { attachments: { maxBytes: 10, maxCount: 2 } },
    {
      download: (attachment: InboundAttachment): Promise<string> =>
        attachment.name === "bad.png"
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(`/workspace/${attachment.name}`),
    },
  );
  transport.emit(
    message({
      attachments: [
        attachment({ id: "a1", name: "good.txt", size: 5 }),
        attachment({ id: "a2", name: "big.bin", size: 11 }),
        attachment({ id: "a3", name: "bad.png", size: 5 }),
        attachment({ id: "a4", name: "extra.txt", size: 5 }),
        attachment({ id: "a5", name: "one-more.txt", size: 5 }),
      ],
    }),
  );
  await bridge.idle();

  const prompt = agent.requests[0]?.text ?? "";
  expect(prompt).toContain("good.txt saved at /workspace/good.txt");
  expect(prompt).toContain("big.bin: skipped, larger than the 10 byte limit");
  expect(prompt).toContain("bad.png: download failed (Error: offline)");
  expect(prompt).toContain("extra.txt saved at /workspace/extra.txt");
  expect(prompt).toContain("one-more.txt: skipped, at most 2 files per message");
  expect(agent.requests[0]?.attachments).toEqual([
    { contentType: "image/png", name: "good.txt", path: "/workspace/good.txt" },
    { contentType: "image/png", name: "extra.txt", path: "/workspace/extra.txt" },
  ]);
});

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    contentType: "image/png",
    id: "a1",
    name: "photo.png",
    size: 1000,
    url: "https://x/y",
    ...overrides,
  };
}

describe("DiscordBridge", () => {
  it("shows typing, then replies to the message with the answer", async () => {
    const { agent, bridge, events, transport } = setup();
    transport.emit(message());
    await bridge.idle();

    expect(agent.requests).toEqual([
      {
        busyMode: "steer",
        conversationKey: `discord:${CHANNEL}`,
        requestId: "discord:600000000000000006",
        text: tagged("hello"),
      },
    ]);
    expect(transport.typing).toEqual([CHANNEL]);
    expect(transport.posted).toEqual([
      {
        channelId: CHANNEL,
        id: "sent-1",
        replyTo: "600000000000000006",
        text: `Echo: ${tagged("hello")}`,
      },
    ]);
    expect(events).toEqual(["accepted", "answered"]);
  });

  it("answers a listed bot once until a person speaks in that conversation again", async () => {
    const LOOPER = "1483185871439003790";
    const { agent, bridge, events, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      { bots: [LOOPER] },
    );
    const fromLooper = (id: string, content: string) =>
      message({ authorId: LOOPER, authorIsBot: true, content, id });

    transport.emit(fromLooper("700000000000000010", `<@${BOT}> run the check`));
    await bridge.idle();
    transport.emit(fromLooper("700000000000000011", `<@${BOT}> run it again`));
    await bridge.idle();
    transport.emit(message({ content: "hello", id: "700000000000000012" }));
    await bridge.idle();
    transport.emit(fromLooper("700000000000000013", `<@${BOT}> once more`));
    await bridge.idle();

    expect(agent.requests.map((request) => request.requestId)).toEqual([
      "discord:700000000000000010",
      "discord:700000000000000012",
      "discord:700000000000000013",
    ]);
    expect(events).toContain("bot_suppressed");
  });

  it("tracks bot turns per conversation, so a loop in one channel cannot mute another", async () => {
    const LOOPER = "1483185871439003790";
    const { agent, bridge, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      {
        bots: [LOOPER],
        guilds: { [GUILD]: { channels: { [CHANNEL]: {}, [OTHER_CHANNEL]: {} } } },
      },
    );
    transport.emit(
      message({
        authorId: LOOPER,
        authorIsBot: true,
        channelId: OTHER_CHANNEL,
        content: `<@${BOT}> ping`,
        id: "700000000000000020",
      }),
    );
    await bridge.idle();
    transport.emit(
      message({
        authorId: LOOPER,
        authorIsBot: true,
        channelId: OTHER_CHANNEL,
        content: `<@${BOT}> ping`,
        id: "700000000000000021",
      }),
    );
    await bridge.idle();
    transport.emit(
      message({
        authorId: LOOPER,
        authorIsBot: true,
        channelId: OTHER_CHANNEL,
        content: `<@${BOT}> ping`,
        id: "700000000000000022",
      }),
    );
    await bridge.idle();

    expect(agent.requests.map((request) => request.requestId)).toEqual([
      "discord:700000000000000020",
    ]);
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
    expect(transport.posted[0]?.text).toBe(`Echo: ${tagged("hello")}`);
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

describe("DiscordBridge with an intercept", () => {
  it("posts an intercept's reply without asking the agent", async () => {
    const agent = new FakeAgent();
    const transport = new FakeTransport();
    const ledger = new FakeLedger();
    const events: string[] = [];
    const bridge = new DiscordBridge({
      agent,
      config,
      intercept: (_message, text) =>
        Promise.resolve(text.endsWith("\nhello") ? { reply: "Handled." } : undefined),
      ledger,
      log: (event) => events.push(event),
      transport,
    });
    bridge.start();
    transport.emit(message());
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.posted.map((item) => item.text)).toEqual(["Handled."]);
    expect(await ledger.pending()).toEqual([]);
    expect(events).toEqual(["accepted", "intercepted"]);
  });

  it("gives the agent an intercept's text, in the conversation it names", async () => {
    const agent = new FakeAgent();
    const transport = new FakeTransport();
    const bridge = new DiscordBridge({
      agent,
      config,
      intercept: () => Promise.resolve({ conversationKey: "job:digest", text: "approved" }),
      ledger: new FakeLedger(),
      log: () => undefined,
      transport,
    });
    bridge.start();
    transport.emit(message());
    await bridge.idle();

    expect(agent.requests).toEqual([
      {
        busyMode: "steer",
        conversationKey: "job:digest",
        requestId: "discord:600000000000000006",
        text: "approved",
      },
    ]);
    expect(transport.posted[0]?.replyTo).toBe("600000000000000006");
  });
});

describe("DiscordBridge after a restart", () => {
  it("answers a message that an earlier process accepted but did not answer", async () => {
    const ledger = new FakeLedger();
    await ledger.accept(message());
    const { bridge, events, transport } = setup(new FakeAgent(), ledger);
    await bridge.idle();

    expect(transport.posted.map((item) => item.text)).toEqual([`Echo: ${tagged("hello")}`]);
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

    expect(agent.requests.map((request) => request.text)).toEqual([
      tagged("missed one"),
      tagged("missed two"),
    ]);
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

describe("DiscordBridge with reactions and progress", () => {
  it("reacts when it accepts a message and clears the reaction once the answer is in", async () => {
    const { bridge, transport } = setup(new FakeAgent(), new FakeLedger(), new FakeTransport(), {
      ackReaction: "👀",
    });
    transport.emit(message());
    await bridge.idle();

    expect(transport.reacted).toEqual([
      { channelId: CHANNEL, emoji: "👀", messageId: "600000000000000006" },
    ]);
    expect(transport.unreacted).toEqual([
      { channelId: CHANNEL, emoji: "👀", messageId: "600000000000000006" },
    ]);
  });

  it("answers on the normal path when no progress note arrived", async () => {
    const { bridge, transport } = setup(new FakeAgent(), new FakeLedger(), new FakeTransport(), {
      progress: true,
    });
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted).toEqual([
      {
        channelId: CHANNEL,
        id: "sent-1",
        replyTo: "600000000000000006",
        text: `Echo: ${tagged("hello")}`,
      },
    ]);
    expect(transport.edits).toEqual([]);
  });

  it("posts the progress notes into one message and edits it into the answer", async () => {
    const { bridge, transport } = setup(
      new ProgressAgent(["Thinking", "bash: git status"]),
      new FakeLedger(),
      new FakeTransport(),
      { progress: true },
    );
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted).toEqual([
      {
        channelId: CHANNEL,
        id: "sent-1",
        replyTo: "600000000000000006",
        text: "Thinking\nbash: git status",
      },
    ]);
    expect(transport.edits.map((edit) => edit.text)).toEqual([`Echo: ${tagged("hello")}`]);
    expect(transport.unreacted).toEqual([]);
  });

  it("edits the failure into the status message when the agent fails", async () => {
    const agent = new FakeAgent(() => ({ kind: "failed", reason: "the model is unreachable" }));
    agent.progress = ["Thinking"];
    const { bridge, transport } = setup(agent, new FakeLedger(), new FakeTransport(), {
      progress: true,
    });
    transport.emit(message());
    await bridge.idle();

    expect(transport.edits.map((edit) => edit.text)).toEqual([
      "Sorry, I could not answer: the model is unreachable",
    ]);
    expect(transport.posted.map((item) => item.text)).toEqual(["Thinking"]);
  });

  it("logs a failed reaction and still answers", async () => {
    const transport = new FakeTransport();
    transport.react = () => Promise.reject(new Error("missing permissions"));
    const { bridge, events } = setup(new FakeAgent(), new FakeLedger(), transport, {
      ackReaction: "👀",
    });
    transport.emit(message());
    await bridge.idle();

    expect(transport.posted.map((item) => item.text)).toEqual([`Echo: ${tagged("hello")}`]);
    expect(events).toEqual(["accepted", "react_failed", "answered"]);
  });

  it("does not react when the configuration names no emoji", async () => {
    const { bridge, transport } = setup();
    transport.emit(message());
    await bridge.idle();

    expect(transport.reacted).toEqual([]);
    expect(transport.unreacted).toEqual([]);
  });
  it("steers a message into the running answer and replies once to the newest message", async () => {
    const gates: ((reply: AgentReply) => void)[] = [];
    const { agent, bridge, events, transport } = setup(
      new FakeAgent(
        () =>
          new Promise<AgentReply>((resolve) => {
            gates.push(resolve);
          }),
      ),
      new FakeLedger(),
      new FakeTransport(),
      { ackReaction: "\u{1F440}" },
    );
    transport.emit(message({ content: "hello", id: "700000000000000030" }));
    transport.emit(message({ content: "also add charts", id: "700000000000000031" }));
    await new Promise((resolve) => setImmediate(resolve));
    for (const resolve of gates) resolve({ kind: "answer", text: `Echo: ${CONTEXT_TAG}\nrun` });
    await bridge.idle();

    expect(agent.requests.map((request) => request.requestId).sort()).toEqual([
      "discord:700000000000000030",
      "discord:700000000000000031",
    ]);
    expect(agent.requests[1]?.busyMode).toBe("steer");
    expect(transport.posted).toEqual([
      {
        channelId: CHANNEL,
        id: "sent-1",
        replyTo: "700000000000000031",
        text: `Echo: ${CONTEXT_TAG}\nrun`,
      },
    ]);
    expect(transport.unreacted.map((item) => item.messageId)).toEqual([
      "700000000000000030",
      "700000000000000031",
    ]);
    expect(events).toEqual(["accepted", "accepted", "answered", "answered"]);
  });

  it("queues a message that starts with the queue keyword for its own answer", async () => {
    const { agent, bridge, transport } = setup();
    transport.emit(message({ content: "q list the files", id: "700000000000000040" }));
    await bridge.idle();

    expect(agent.requests[0]?.text).toBe(tagged("list the files"));
    expect(agent.requests[0]?.busyMode).toBe("followUp");
    expect(transport.posted[0]?.replyTo).toBe("700000000000000040");
    expect(transport.posted[0]?.text).toBe(`Echo: ${tagged("list the files")}`);
  });

  it("answers an owner's command before the agent, without the eyes", async () => {
    const { agent, bridge, events, ledger, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      {},
      {
        command: (_message: unknown, text: string): Promise<string | undefined> =>
          Promise.resolve(text === "/status" ? "model: test" : undefined),
      },
    );
    transport.emit(message({ content: `<@${BOT}> /status`, id: "700000000000000050" }));
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.posted).toEqual([
      { channelId: CHANNEL, id: "sent-1", replyTo: "700000000000000050", text: "model: test" },
    ]);
    expect(transport.reacted).toEqual([]);
    expect(await ledger.pending()).toEqual([]);
    expect(events).toEqual(["commanded"]);
  });

  it("re-downloads attachments when it resumes an unanswered message", async () => {
    const downloads: string[] = [];
    const agent = new FakeAgent();
    const transport = new FakeTransport();
    const ledger = new FakeLedger();
    const bridge = new DiscordBridge({
      agent,
      config: parseAdapterConfig(oneChannel()),
      download: (att: InboundAttachment) => {
        downloads.push(att.name);
        return Promise.resolve(`/workspace/${att.name}`);
      },
      ledger,
      log: () => undefined,
      transport,
    });
    await ledger.accept(message({ attachments: [attachment()] }));
    bridge.start();
    await bridge.idle();

    expect(downloads).toEqual(["photo.png"]);
    expect(agent.requests[0]?.text).toContain("photo.png saved at /workspace/photo.png");
    expect(agent.requests[0]?.attachments).toEqual([
      { contentType: "image/png", name: "photo.png", path: "/workspace/photo.png" },
    ]);
  });
});

describe("DiscordBridge owner commands", () => {
  it("aborts on a bare stop from an owner, without the agent", async () => {
    const { agent, bridge, events, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      {},
      {
        command: (_message: unknown, text: string): Promise<string | undefined> =>
          Promise.resolve(
            text === "/stop" ? "Stopped; the answer so far stays in the transcript." : undefined,
          ),
      },
    );
    transport.emit(message({ content: `<@${BOT}> STOP`, id: "700000000000000053" }));
    await bridge.idle();

    expect(agent.requests).toEqual([]);
    expect(transport.reacted).toEqual([]);
    expect(transport.posted[0]?.text).toBe("Stopped; the answer so far stays in the transcript.");
    expect(events).toEqual(["commanded"]);
  });

  it("lets a longer message that merely mentions stop flow to the agent", async () => {
    const { agent, bridge, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      {},
      {
        command: (): Promise<string | undefined> => Promise.resolve("aborted"),
      },
    );
    transport.emit(message({ content: `<@${BOT}> stop doing that`, id: "700000000000000054" }));
    await bridge.idle();

    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]?.text).toBe(tagged("stop doing that"));
  });

  it("lets an unknown command flow to the agent as ordinary text", async () => {
    const { agent, bridge, transport } = setup(
      new FakeAgent(),
      new FakeLedger(),
      new FakeTransport(),
      {},
      {
        command: (): Promise<string | undefined> => Promise.resolve(undefined),
      },
    );
    transport.emit(message({ content: `<@${BOT}> /frobnicate`, id: "700000000000000052" }));
    await bridge.idle();

    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]?.text).toBe(tagged("/frobnicate"));
  });
});
