import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_HELD_COMMANDS } from "./approvals.ts";
import {
  answersWithoutMention,
  parseAdapterConfig,
  parseDiscordIds,
  type AdapterConfig,
} from "@onurpi/discord-adapter";

export const MODEL_PROVIDERS = [
  "echo",
  "anthropic",
  "huggingface",
  "openai",
  "openai-codex",
  "opencode-go",
  "openrouter",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export type WorkerConfig = {
  /** Folder the agent works in. Its tools act here. */
  readonly workspace: string;
  /** Pi agent folder. As in Pi, its `AGENTS.md` is the global instructions file. */
  readonly agentDir: string;
  /** SQLite file that holds the agent's conversations and work. */
  readonly storage: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly modelId: string;
  };
  /**
   * Tool calls that wait for the owner's approval in Discord: `bash` commands that match a pattern.
   * Cards for conversations that are not a Discord channel go to `channelId`.
   */
  readonly approvals: { readonly held: readonly RegExp[]; readonly channelId?: string };
  /** Scheduled prompts that the host scheduler delivers, with the channels they may post to. */
  readonly inbox?: {
    readonly folder: string;
    readonly channelIds: readonly string[];
    /** Answers that mean "nothing to report": posted nowhere, but the delivery completes. */
    readonly suppress?: readonly string[];
  };
  /** Voice notes and audio attachments get transcribed: a `url` posts to the general service,
   * absence uses the baked-in whisper.cpp, and `false` turns it off. */
  readonly stt?: { readonly model?: string; readonly url?: string } | false;
  readonly discord: AdapterConfig & {
    /** Name of the environment variable that holds the bot token. The token never goes in this file. */
    readonly tokenEnv: string;
    readonly messageContent: boolean;
    /** Base URL of a host-side Discord REST relay. Requests carry no token; the relay adds it. */
    readonly restProxy?: string;
    /** The agent's discord tool. Admin actions (pin, delete, threads, reactions) wait for this flag. */
    readonly agentTools?: { readonly admin?: boolean };
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

function stringArrayOf(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of text`);
  }
  return value.map((item) => item as string);
}

function isProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

function parseModel(value: unknown): WorkerConfig["model"] {
  const model = record(value, "model");
  const provider = text(model["provider"], "model.provider");
  if (!isProvider(provider)) {
    throw new Error(`model.provider must be one of: ${MODEL_PROVIDERS.join(", ")}`);
  }
  const modelId = provider === "echo" ? "echo" : text(model["modelId"], "model.modelId");
  return { modelId, provider };
}

/** The discord.agentTools section: which tool tiers are on. */
function parseAgentTools(value: unknown): { admin?: boolean } {
  const input = record(value, "discord.agentTools");
  const admin = input["admin"] ?? false;
  if (typeof admin !== "boolean") {
    throw new Error("discord.agentTools.admin must be true or false");
  }
  return { admin };
}

/** The token's environment variable name, which must be a name and not a token. */
function parseTokenEnv(value: unknown): string {
  const tokenEnv = text(value ?? "DISCORD_BOT_TOKEN", "discord.tokenEnv");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error(
      "discord.tokenEnv must be an environment variable name such as DISCORD_BOT_TOKEN",
    );
  }
  return tokenEnv;
}

function parseStt(value: unknown): { model?: string; url?: string } | false {
  if (value === false) return false;
  const input = record(value, "stt");
  const model = input["model"];
  const url = input["url"];
  if (url !== undefined && (typeof url !== "string" || !/^https?:\/\//u.test(url))) {
    throw new Error("stt.url must be an http(s) URL of a transcription service");
  }
  return {
    ...(model === undefined ? {} : { model: text(model, "stt.model") }),
    ...(url === undefined ? {} : { url }),
  };
}

/** The base URL of the Discord REST relay, when one is set. */
function parseRestProxy(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^https?:\/\//u.test(value)) {
    throw new Error("discord.restProxy must be an http(s) URL of a Discord REST relay");
  }
  return value;
}

function parseDiscord(value: unknown): WorkerConfig["discord"] {
  const discord = record(value, "discord");
  const tokenEnv = parseTokenEnv(discord["tokenEnv"]);
  const messageContent = discord["messageContent"] ?? false;
  if (typeof messageContent !== "boolean")
    throw new Error("discord.messageContent must be true or false");
  const restProxy = parseRestProxy(discord["restProxy"]);
  const agentTools =
    discord["agentTools"] === undefined ? undefined : parseAgentTools(discord["agentTools"]);
  const adapter = parseAdapterConfig(discord);
  if (!messageContent && answersWithoutMention(adapter)) {
    throw new Error(
      "discord.messageContent must be true when a channel answers without a mention, because Discord sends the bot the text of other messages only with the Message Content intent",
    );
  }
  return {
    ...adapter,
    messageContent,
    tokenEnv,
    ...(restProxy === undefined ? {} : { restProxy }),
    ...(agentTools === undefined ? {} : { agentTools }),
  };
}

function parseApprovals(value: unknown): WorkerConfig["approvals"] {
  const input = record(value ?? {}, "approvals");
  const held = input["held"] ?? DEFAULT_HELD_COMMANDS;
  if (!Array.isArray(held) || held.some((pattern) => typeof pattern !== "string")) {
    throw new Error("approvals.held must be a list of regular expressions");
  }
  const channel = input["channelId"];
  return {
    held: held.map((pattern: string) => new RegExp(pattern, "u")),
    ...(channel === undefined
      ? {}
      : { channelId: parseDiscordIds([channel], "approvals.channelId")[0] ?? "" }),
  };
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
  const agentDir =
    input["agentDir"] === undefined
      ? join(homedir(), ".pi", "agent")
      : at(text(input["agentDir"], "agentDir"));
  const inbox = input["inbox"] === undefined ? undefined : record(input["inbox"], "inbox");
  return {
    agentDir,
    approvals: parseApprovals(input["approvals"]),
    discord: parseDiscord(input["discord"]),
    ...(inbox === undefined
      ? {}
      : {
          inbox: {
            channelIds: parseDiscordIds(inbox["channelIds"], "inbox.channelIds"),
            folder: at(text(inbox["folder"], "inbox.folder")),
            ...(inbox["suppress"] === undefined
              ? {}
              : {
                  suppress: stringArrayOf(inbox["suppress"], "inbox.suppress"),
                }),
          },
        }),
    model: parseModel(input["model"]),
    ...(input["stt"] === undefined ? {} : { stt: parseStt(input["stt"]) }),
    storage,
    workspace,
  };
}

/** Reads `config.json`. Paths in it are resolved against the file's own folder. */
export function loadWorkerConfig(file: string): WorkerConfig {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parseWorkerConfig(parsed, dirname(resolve(file)));
}
