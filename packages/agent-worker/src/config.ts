import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseAdapterConfig, type AdapterConfig } from "@onurpi/discord-adapter";

export const MODEL_PROVIDERS = [
  "echo",
  "anthropic",
  "huggingface",
  "openai",
  "openai-codex",
  "openrouter",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export type WorkerConfig = {
  /** Folder the agent works in. Its tools act here, and `AGENTS.md` is read from here. */
  readonly workspace: string;
  /** SQLite file that holds the agent's conversations and work. */
  readonly storage: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly modelId: string;
    /** Pi agent folder whose codex-switcher logins the `openai-codex` provider uses. */
    readonly agentDir: string;
  };
  readonly discord: AdapterConfig & {
    /** Name of the environment variable that holds the bot token. The token never goes in this file. */
    readonly tokenEnv: string;
    readonly messageContent: boolean;
  };
};

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${path} must be text`);
  return value;
}

function isProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

function parseModel(value: unknown, at: (path: string) => string): WorkerConfig["model"] {
  const model = record(value, "model");
  const provider = text(model["provider"], "model.provider");
  if (!isProvider(provider)) {
    throw new Error(`model.provider must be one of: ${MODEL_PROVIDERS.join(", ")}`);
  }
  const modelId = provider === "echo" ? "echo" : text(model["modelId"], "model.modelId");
  const agentDir =
    model["agentDir"] === undefined
      ? join(homedir(), ".pi", "agent")
      : at(text(model["agentDir"], "model.agentDir"));
  return { agentDir, modelId, provider };
}

function parseDiscord(value: unknown): WorkerConfig["discord"] {
  const discord = record(value, "discord");
  const tokenEnv = text(discord["tokenEnv"] ?? "DISCORD_BOT_TOKEN", "discord.tokenEnv");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error(
      "discord.tokenEnv must be an environment variable name such as DISCORD_BOT_TOKEN",
    );
  }
  const messageContent = discord["messageContent"] ?? false;
  if (typeof messageContent !== "boolean")
    throw new Error("discord.messageContent must be true or false");
  return { ...parseAdapterConfig(discord), messageContent, tokenEnv };
}

/** Parses a configuration object. Relative paths are resolved against `base`. */
export function parseWorkerConfig(value: unknown, base: string): WorkerConfig {
  const input = record(value, "config");
  const at = (path: string): string => (isAbsolute(path) ? path : resolve(base, path));
  const workspace = at(text(input["workspace"], "workspace"));
  const storage = at(
    input["storage"] === undefined
      ? resolve(workspace, "agent.sqlite")
      : text(input["storage"], "storage"),
  );
  return {
    discord: parseDiscord(input["discord"]),
    model: parseModel(input["model"], at),
    storage,
    workspace,
  };
}

/** Reads `config.json`. Paths in it are resolved against the file's own folder. */
export function loadWorkerConfig(file: string): WorkerConfig {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parseWorkerConfig(parsed, dirname(resolve(file)));
}
