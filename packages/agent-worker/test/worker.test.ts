import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscordTransport, InboundMessage } from "@onurpi/discord-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig, type WorkerConfig } from "../src/config.ts";
import { deliver } from "../src/inbox.ts";
import { defaultDependencies, startWorker, type WorkerDependencies } from "../src/worker.ts";

const BOT = "100000000000000001";
const OWNER = "200000000000000002";
const CHANNEL = "400000000000000004";
const GUILD = "700000000000000007";
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

function config(): WorkerConfig {
  const folder = mkdtempSync(join(tmpdir(), "agent-worker-"));
  folders.push(folder);
  return parseWorkerConfig(
    {
      discord: {
        guilds: { [GUILD]: { channels: { [CHANNEL]: {} } } },
        ownerIds: [OWNER],
        tokenEnv: "TEST_BOT_TOKEN",
      },
      agentDir: folder,
      model: { provider: "echo" },
      workspace: folder,
    },
    folder,
  );
}

class FakeDiscord implements DiscordTransport {
  readonly botUserId = BOT;
  readonly sent: string[] = [];
  closed = false;
  private handler: ((message: InboundMessage) => void) | undefined;

  onMessage(handler: (message: InboundMessage) => void): void {
    this.handler = handler;
  }

  emit(message: InboundMessage): void {
    this.handler?.(message);
  }

  startTyping(): Promise<void> {
    return Promise.resolve();
  }

  send(_channelId: string, text: string): Promise<string> {
    this.sent.push(text);
    return Promise.resolve(String(this.sent.length));
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  readonly history: InboundMessage[] = [];

  fetchAfter(channelId: string, afterId: string): Promise<readonly InboundMessage[]> {
    return Promise.resolve(
      this.history.filter(
        (item) => item.channelId === channelId && BigInt(item.id) > BigInt(afterId),
      ),
    );
  }

  hasReply(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

function ping(id: string, content = `<@${BOT}> ping`): InboundMessage {
  return {
    authorId: OWNER,
    authorIsBot: false,
    channelId: CHANNEL,
    content,
    guildId: GUILD,
    id,
    isDirect: false,
    mentionsBot: true,
    parentChannelId: null,
  };
}

function dependencies(
  discord: FakeDiscord,
  env: NodeJS.ProcessEnv = { TEST_BOT_TOKEN: "test-token" },
) {
  const events: string[] = [];
  const tokens: string[] = [];
  const deps: WorkerDependencies = {
    connect: (token) => {
      tokens.push(token);
      return Promise.resolve(discord);
    },
    env,
    log: (event) => events.push(event),
  };
  return { deps, events, tokens };
}

describe("startWorker", () => {
  it("answers a Discord message from the owner and stops cleanly", async () => {
    const discord = new FakeDiscord();
    const { deps, events, tokens } = dependencies(discord);
    const worker = await startWorker(config(), deps);
    expect(tokens).toEqual(["test-token"]);

    discord.emit({
      authorId: OWNER,
      authorIsBot: false,
      channelId: CHANNEL,
      content: `<@${BOT}> ping`,
      guildId: GUILD,
      id: "600000000000000006",
      isDirect: false,
      mentionsBot: true,
      parentChannelId: null,
    });
    await worker.bridge.idle();
    await worker.stop();

    expect(discord.sent).toEqual(["Echo: ping"]);
    expect(events).toEqual(["ready", "accepted", "answered"]);
    expect(discord.closed).toBe(true);
  });

  it("refuses to start without a token", async () => {
    const { deps } = dependencies(new FakeDiscord(), {});
    await expect(startWorker(config(), deps)).rejects.toThrow(
      "Set the Discord bot token in the environment variable TEST_BOT_TOKEN",
    );
  });

  it("closes the storage when Discord cannot connect", async () => {
    const settings = config();
    const deps: WorkerDependencies = {
      connect: () => Promise.reject(new Error("invalid token")),
      env: { TEST_BOT_TOKEN: "bad" },
      log: () => undefined,
    };
    await expect(startWorker(settings, deps)).rejects.toThrow("invalid token");
    // The storage was closed, so a new worker can open it again.
    const worker = await startWorker(settings, dependencies(new FakeDiscord()).deps);
    await worker.stop();
  });

  it("logs one JSON line per event by default", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    defaultDependencies.log("accepted", { message: "1" });
    spy.mockRestore();

    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "accepted", message: "1" });
  });

  it("after a restart, answers the unanswered message and the ones that arrived meanwhile", async () => {
    const settings = config();
    const first = new FakeDiscord();
    const running = await startWorker(settings, dependencies(first).deps);
    first.emit(ping("600000000000000006"));
    await running.bridge.idle();
    // A message the first process accepted but never answered, as after a crash.
    await running.agent.ledger.accept(ping("600000000000000007", `<@${BOT}> waiting`));
    await running.stop();

    const second = new FakeDiscord();
    second.history.push(ping("600000000000000008", `<@${BOT}> missed`));
    const restarted = await startWorker(settings, dependencies(second).deps);
    await restarted.bridge.idle();
    await restarted.stop();

    expect(first.sent).toEqual(["Echo: ping"]);
    expect([...second.sent].sort()).toEqual(["Echo: missed", "Echo: waiting"]);
  });

  it("posts the answer of a delivered prompt to the job's channel", async () => {
    const settings = config();
    const inboxed = {
      ...settings,
      inbox: { channelIds: [CHANNEL], folder: join(settings.workspace, "inbox") },
    };
    // Delivered before the start, so the first scan finds it.
    await deliver(inboxed.inbox.folder, {
      channelId: CHANNEL,
      job: "digest",
      prompt: "news",
      scheduledFor: "2026-10-18T01:00:00Z",
    });
    const discord = new FakeDiscord();
    const running = await startWorker(inboxed, dependencies(discord).deps);
    for (let tries = 0; tries < 40 && discord.sent.length === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await running.stop();

    expect(discord.sent).toEqual(["Echo: news"]);
    expect(readdirSync(join(inboxed.inbox.folder, "done"))).toEqual([
      "digest@2026-10-18T01:00:00.000Z.json",
    ]);
  });
});
