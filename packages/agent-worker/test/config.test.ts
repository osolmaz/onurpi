import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkerConfig, parseWorkerConfig } from "../src/config.ts";

const OWNER = "200000000000000002";
const discord = { ownerIds: [OWNER] };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

describe("parseWorkerConfig", () => {
  it("resolves paths against the base folder and fills in defaults", () => {
    expect(
      parseWorkerConfig({ discord, model: { provider: "echo" }, workspace: "work" }, "/srv/agent"),
    ).toEqual({
      discord: {
        channelIds: [],
        directMessages: true,
        messageContent: false,
        ownerIds: [OWNER],
        requireMention: true,
        tokenEnv: "DISCORD_BOT_TOKEN",
      },
      model: { agentDir: join(homedir(), ".pi", "agent"), modelId: "echo", provider: "echo" },
      storage: "/srv/agent/work/agent.sqlite",
      workspace: "/srv/agent/work",
    });
  });

  it("keeps absolute paths and explicit choices", () => {
    const config = parseWorkerConfig(
      {
        discord: { ...discord, messageContent: true, tokenEnv: "AGENT_BOT_TOKEN" },
        model: { agentDir: "pi", modelId: "gpt-6.1-sol", provider: "openai-codex" },
        storage: "/data/agent.sqlite",
        workspace: "/sandbox/workspace",
      },
      "/elsewhere",
    );
    expect(config.storage).toBe("/data/agent.sqlite");
    expect(config.workspace).toBe("/sandbox/workspace");
    expect(config.model).toEqual({
      agentDir: "/elsewhere/pi",
      modelId: "gpt-6.1-sol",
      provider: "openai-codex",
    });
    expect(config.discord.tokenEnv).toBe("AGENT_BOT_TOKEN");
    expect(config.discord.messageContent).toBe(true);
  });

  const valid = { discord, model: { provider: "echo" }, workspace: "/w" };
  it.each([
    [null, "config must be an object"],
    [{ ...valid, workspace: "" }, "workspace must be text"],
    [{ ...valid, storage: 3 }, "storage must be text"],
    [{ ...valid, model: { provider: "llama" } }, "model.provider must be one of"],
    [{ ...valid, model: { provider: "openai" } }, "model.modelId must be text"],
    [{ ...valid, model: { agentDir: "", provider: "echo" } }, "model.agentDir must be text"],
    [
      { ...valid, discord: { ...discord, tokenEnv: "my token" } },
      "discord.tokenEnv must be an environment variable",
    ],
    [
      { ...valid, discord: { ...discord, messageContent: "no" } },
      "discord.messageContent must be true or false",
    ],
    [{ ...valid, discord: {} }, "discord.ownerIds must be a list of Discord ids"],
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
});
