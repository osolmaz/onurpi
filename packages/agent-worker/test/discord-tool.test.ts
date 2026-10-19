import { describe, expect, it } from "vitest";

import { createDiscordTool } from "../src/discord-tool.ts";
import type { WorkerConfig } from "../src/config.ts";

process.env["DISCORD_BOT_TOKEN"] = "tok";

const config = {
  discord: { tokenEnv: "DISCORD_BOT_TOKEN", agentTools: { admin: true } },
} as unknown as WorkerConfig;

type Reply = { status: number; body?: unknown; empty?: boolean };

/** A fetch stub serving one canned reply per path, recording every call. */
function stubFetch(replies: Record<string, Reply>): {
  calls: { path: string; init: RequestInit }[];
  fetchImpl: typeof fetch;
} {
  const calls: { path: string; init: RequestInit }[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace("https://discord.com/api/v10", "");
    calls.push({ init: init ?? {}, path });
    const reply = replies[path] ?? { status: 404, body: '{"message": "nope"}' };
    return Promise.resolve(
      new Response(reply.empty ? null : JSON.stringify(reply.body ?? {}), { status: reply.status }),
    );
  };
  return { calls, fetchImpl: impl };
}

type Result = { output?: { type: string; text: string }[]; isError?: boolean };

const textOf = (result: Result): string => result.output?.[0]?.text ?? "";

function run(tool: ReturnType<typeof createDiscordTool>, args: unknown): Promise<Result> {
  return tool.execute(
    args as never,
    { conversationId: 7 } as never,
    undefined as never,
  ) as Promise<Result>;
}

const noChannel = (): Promise<string | undefined> => Promise.resolve(undefined);
const channel = (): Promise<string | undefined> => Promise.resolve("discord:400000000000000004");

const messages = [
  {
    id: "2000000000000000002",
    timestamp: "2026-10-19T14:44:16Z",
    content: "model: test",
    author: { id: "1483185871439003790", username: "looper", global_name: "Looper" },
  },
  {
    id: "2000000000000000001",
    timestamp: "2026-10-19T14:44:15Z",
    content: "stop",
    author: { id: "1483185871439003790", username: "looper", global_name: "Looper" },
    attachments: [{ name: "photo.png" }],
  },
];

describe("discord tool", () => {
  it("fetches the calling conversation's channel when no channel_id is given", async () => {
    const stub = stubFetch({
      "/channels/400000000000000004/messages?limit=20": { body: messages, status: 200 },
    });
    const tool = createDiscordTool({ config, channelOf: channel, fetchImpl: stub.fetchImpl });
    const result = await run(tool, { action: "fetch_messages" });

    expect(result.isError).toBeUndefined();
    expect(stub.calls[0]?.path).toBe("/channels/400000000000000004/messages?limit=20");
    const text = result.output?.[0]?.text ?? "";
    expect(text).toContain("oldest first");
    expect(text.indexOf("stop")).toBeLessThan(text.indexOf("model: test"));
    expect(text).toContain("[attachment: photo.png]");
  });

  it("respects the limit and an explicit channel_id", async () => {
    const stub = stubFetch({
      "/channels/400000000000000009/messages?limit=5": { body: [], status: 200 },
    });
    const tool = createDiscordTool({ config, channelOf: noChannel, fetchImpl: stub.fetchImpl });
    const result = await run(tool, {
      action: "fetch_messages",
      channel_id: "400000000000000009",
      limit: 5,
    });

    expect(result.output?.[0]?.text).toContain("No messages found.");
    expect(stub.calls[0]?.path).toBe("/channels/400000000000000009/messages?limit=5");
  });

  it("lists a server's channels, defaulting to the bot's first server", async () => {
    const stub = stubFetch({
      "/guilds/1459246755253325866/channels": {
        body: [
          { id: "1459246755253325866", name: "Text Channels", type: 4 },
          { id: "1459246755253325869", name: "general", type: 0 },
          { id: "1459257251033514159", name: "inbox", type: 0 },
        ],
        status: 200,
      },
      "/users/@me/guilds": { body: [{ id: "1459246755253325866" }], status: 200 },
    });
    const tool = createDiscordTool({ config, channelOf: noChannel, fetchImpl: stub.fetchImpl });
    const result = await run(tool, { action: "list_channels" });

    expect(stub.calls[0]?.path).toBe("/users/@me/guilds");
    expect(result.output?.[0]?.text).toBe(
      "category Text Channels (1459246755253325866)\n" +
        "text general (1459246755253325869)\n" +
        "text inbox (1459257251033514159)",
    );
  });

  it("gates admin actions behind the config flag", async () => {
    const stub = stubFetch({});
    const tool = createDiscordTool({
      config: { discord: { tokenEnv: "DISCORD_BOT_TOKEN" } } as unknown as WorkerConfig,
      channelOf: noChannel,
      fetchImpl: stub.fetchImpl,
    });
    const result = await run(tool, {
      action: "delete_message",
      channel_id: "400000000000000004",
      message_id: "200000000000000001",
    });

    expect(result.isError).toBe(true);
    expect(result.output?.[0]?.text).toContain("admin-only");
    expect(stub.calls).toEqual([]);
  });

  it("pins, reacts, and creates threads when admin is on", async () => {
    const stub = stubFetch({
      "/channels/400000000000000004/messages/200000000000000001/reactions/%F0%9F%91%8D/@me": {
        empty: true,
        status: 204,
      },
      "/channels/400000000000000004/messages/200000000000000001/threads": {
        body: { id: "300000000000000001" },
        status: 201,
      },
      "/channels/400000000000000004/pins/200000000000000001": { empty: true, status: 204 },
    });
    const tool = createDiscordTool({ config, channelOf: noChannel, fetchImpl: stub.fetchImpl });
    const target = { channel_id: "400000000000000004", message_id: "200000000000000001" };

    const pinned = await run(tool, { action: "pin_message", ...target });
    expect(stub.calls[0]?.init.method).toBe("PUT");
    expect(textOf(pinned)).toContain("Pinned 200000000000000001");

    const reacted = await run(tool, { action: "add_reaction", emoji: "👍", ...target });
    expect(stub.calls[1]?.path).toContain("/reactions/%F0%9F%91%8D/@me");
    expect(textOf(reacted)).toContain("Reacted 👍");

    const thread = await run(tool, { action: "create_thread", name: "Follow-up", ...target });
    expect(textOf(thread)).toContain("Created thread “Follow-up” (300000000000000001)");
  });

  it("maps Discord's denial to a readable error", async () => {
    const stub = stubFetch({
      "/channels/400000000000000004/messages?limit=20": { body: {}, status: 403 },
    });
    const tool = createDiscordTool({ config, channelOf: channel, fetchImpl: stub.fetchImpl });
    const result = await run(tool, { action: "fetch_messages" });

    expect(result.isError).toBe(true);
    expect(result.output?.[0]?.text).toContain("Discord denies it");
  });

  it("fails clearly when the token is missing", async () => {
    const stub = stubFetch({});
    const prior = process.env["DISCORD_BOT_TOKEN"];
    process.env["DISCORD_BOT_TOKEN"] = "";
    try {
      const tool = createDiscordTool({ config, channelOf: noChannel, fetchImpl: stub.fetchImpl });
      const result = await run(tool, {
        action: "fetch_messages",
        channel_id: "400000000000000004",
      });
      expect(result.isError).toBe(true);
      expect(result.output?.[0]?.text).toContain("$DISCORD_BOT_TOKEN is not set");
    } finally {
      process.env["DISCORD_BOT_TOKEN"] = prior;
    }
  });
});
