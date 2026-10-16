import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscordTransport, InboundMessage } from "@onurpi/discord-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig, type WorkerConfig } from "../src/config.ts";
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
});
