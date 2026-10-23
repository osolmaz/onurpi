import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HELD_COMMANDS } from "../src/approvals.ts";
import { loadWorkerConfig, parseWorkerConfig } from "../src/config.ts";

const OWNER = "200000000000000002";
const discord = { ownerIds: [OWNER] };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

describe("parseWorkerConfig", () => {
  it("accepts a model from the OpenCode Go provider", () => {
    const model = { modelId: "deepseek-v4.1-flash", provider: "opencode-go" };
    expect(parseWorkerConfig({ discord, model, workspace: "/w" }, "/srv/agent").model).toEqual(
      model,
    );
  });

  it("resolves paths against the base folder and fills in defaults", () => {
    expect(
      parseWorkerConfig({ discord, model: { provider: "echo" }, workspace: "work" }, "/srv/agent"),
    ).toEqual({
      agentDir: join(homedir(), ".pi", "agent"),
      approvals: { held: DEFAULT_HELD_COMMANDS.map((pattern) => new RegExp(pattern, "u")) },
      discord: {
        directMessages: true,
        guilds: {},
        messageContent: false,
        ownerIds: [OWNER],
        tokenEnv: "DISCORD_BOT_TOKEN",
      },
      model: { modelId: "echo", provider: "echo" },
      storage: "/srv/agent/work/agent.sqlite",
      workspace: "/srv/agent/work",
    });
  });

  it("keeps absolute paths and explicit choices", () => {
    const config = parseWorkerConfig(
      {
        discord: { ...discord, messageContent: true, tokenEnv: "AGENT_BOT_TOKEN" },
        agentDir: "pi",
        model: { modelId: "gpt-6.1-sol", provider: "openai-codex" },
        storage: "/data/agent.sqlite",
        workspace: "/sandbox/work",
      },
      "/elsewhere",
    );
    expect(config.storage).toBe("/data/agent.sqlite");
    expect(config.workspace).toBe("/sandbox/work");
    expect(config.agentDir).toBe("/elsewhere/pi");
    expect(config.model).toEqual({ modelId: "gpt-6.1-sol", provider: "openai-codex" });
    expect(config.discord.tokenEnv).toBe("AGENT_BOT_TOKEN");
    expect(config.discord.messageContent).toBe(true);
  });

  it("keeps a rest relay url and rejects broken ones", () => {
    const config = parseWorkerConfig(
      { ...valid, discord: { ...discord, restProxy: "http://100.119.251.79:8771" } },
      "/elsewhere",
    );
    expect(config.discord.restProxy).toBe("http://100.119.251.79:8771");
    expect(() =>
      parseWorkerConfig(
        { ...valid, discord: { ...discord, restProxy: "not a url" } },
        "/elsewhere",
      ),
    ).toThrow("discord.restProxy must be an http(s) URL");
  });

  const valid = { discord, model: { provider: "echo" }, workspace: "/w" };
  it.each([
    [null, "config must be an object"],
    [{ ...valid, workspace: "" }, "workspace must be text"],
    [{ ...valid, storage: 3 }, "storage must be text"],
    [{ ...valid, model: { provider: "llama" } }, "model.provider must be one of"],
    [{ ...valid, model: { provider: "openai" } }, "model.modelId must be text"],
    [{ ...valid, agentDir: "" }, "agentDir must be text"],
    [
      { ...valid, approvals: { held: [3] } },
      "approvals.held must be a list of regular expressions",
    ],
    [{ ...valid, approvals: { channelId: "x" } }, "approvals.channelId[0] must be a Discord id"],
    [
      { ...valid, discord: { ...discord, tokenEnv: "my token" } },
      "discord.tokenEnv must be an environment variable",
    ],
    [
      { ...valid, discord: { ...discord, messageContent: "no" } },
      "discord.messageContent must be true or false",
    ],
    [{ ...valid, discord: {} }, "discord.ownerIds must be a list of Discord ids"],
    [
      {
        ...valid,
        discord: {
          ...discord,
          guilds: {
            "700000000000000007": { channels: { "400000000000000004": {} }, requireMention: false },
          },
        },
      },
      "discord.messageContent must be true when a channel answers without a mention",
    ],
  ])("rejects %j", (value, error) => {
    expect(() => parseWorkerConfig(value, "/base")).toThrow(error);
  });
});

describe("loadWorkerConfig", () => {
  it("resolves paths against the configuration file's folder", () => {
    const folder = mkdtempSync(join(tmpdir(), "agent-worker-config-"));
    folders.push(folder);
    const file = join(folder, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ discord, model: { provider: "echo" }, workspace: "workspace" }),
    );
    expect(loadWorkerConfig(file).workspace).toBe(join(folder, "workspace"));
  });

  it("reads an inbox folder and its channels", () => {
    const config = parseWorkerConfig(
      {
        discord,
        inbox: { channelIds: ["400000000000000004"], folder: ".agent-worker/inbox" },
        model: { provider: "echo" },
        workspace: "/srv/agent",
      },
      "/srv/config",
    );
    expect(config.inbox).toEqual({
      channelIds: ["400000000000000004"],
      folder: "/srv/config/.agent-worker/inbox",
    });
    expect(() =>
      parseWorkerConfig(
        {
          discord,
          inbox: { channelIds: ["1"], folder: "x" },
          model: { provider: "echo" },
          workspace: "/w",
        },
        "/",
      ),
    ).toThrow("inbox.channelIds[0] must be a Discord id");
  });

  it("reads held commands and a card channel for approvals", () => {
    const config = parseWorkerConfig(
      {
        approvals: { channelId: "400000000000000004", held: ["^deploy"] },
        discord,
        model: { provider: "echo" },
        workspace: "/w",
      },
      "/base",
    );
    expect(config.approvals).toEqual({ channelId: "400000000000000004", held: [/^deploy/u] });
  });
});
