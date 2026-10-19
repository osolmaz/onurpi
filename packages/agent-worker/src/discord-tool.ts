import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { Type, type Static } from "typebox";

import type { WorkerConfig } from "./config.ts";

const API = "https://discord.com/api/v10";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CONTENT_MAX = 1_000;

/** The discord tool's input. Only the fields an action needs are required at run time. */
const schema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("fetch_messages"),
      Type.Literal("list_channels"),
      Type.Literal("pin_message"),
      Type.Literal("unpin_message"),
      Type.Literal("delete_message"),
      Type.Literal("create_thread"),
      Type.Literal("add_reaction"),
    ],
    {
      description:
        "fetch_messages reads a channel's recent messages (oldest first); list_channels lists a server's channels; the rest are admin actions: pin or unpin or delete a message, start a thread from a message, add a reaction",
    },
  ),
  channel_id: Type.Optional(
    Type.String({
      description:
        "Channel id. fetch_messages without one reads the current conversation's channel.",
    }),
  ),
  message_id: Type.Optional(
    Type.String({ description: "Message id, for the message-level admin actions" }),
  ),
  guild_id: Type.Optional(
    Type.String({
      description: "Server id, for list_channels; default: the first server the bot is in",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: `Messages to fetch, 1-${MAX_LIMIT}; default ${DEFAULT_LIMIT}` }),
  ),
  before: Type.Optional(
    Type.String({
      description:
        "Message id to page backwards from: fetch the messages just before this one. The result names the id to pass next.",
    }),
  ),
  emoji: Type.Optional(
    Type.String({ description: "Reaction emoji, such as 👍 or name:id for a custom one" }),
  ),
  name: Type.Optional(Type.String({ description: "Thread name, for create_thread" })),
});

type ActionArgs = Static<typeof schema>;

/** A Discord snowflake: text of 15-20 digits. */
function isSnowflake(value: string): boolean {
  return /^\d{15,20}$/u.test(value);
}

/** Text out of an unknown JSON field, with a fallback. */
function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** A Discord id argument, or a readable error. */
function requireSnowflake(value: string | undefined, name: string): string {
  if (value === undefined || !isSnowflake(value)) {
    throw new Error(`${name} must be a Discord id, such as 400000000000000004`);
  }
  return value;
}

/** A failed call as guidance the model can act on. */
function reasonFor(status: number, body: string): string {
  const detail = body === "" ? "" : ` (${body})`;
  if (status === 403) return `Discord denies it: the bot lacks the permissions for this${detail}`;
  if (status === 404) return `not found: check the id${detail}`;
  if (status === 429) return `rate limited by Discord; try again shortly${detail}`;
  return `Discord answered ${status}${detail}`;
}

/** One API call, with the bot token from the configured environment variable. */
async function call(
  config: WorkerConfig,
  fetchImpl: typeof fetch,
  path: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  const token = (process.env[config.discord.tokenEnv] ?? "").trim();
  if (token === "") {
    throw new Error(`the bot token is missing: $${config.discord.tokenEnv} is not set`);
  }
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Discord is unreachable: ${(error as Error).message}`, { cause: error });
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 512);
    throw new Error(reasonFor(response.status, text));
  }
  return response.status === 204 ? undefined : await response.json();
}

/** The author half of a message line. */
function authorOf(message: Record<string, unknown>): string {
  const author = message["author"] as Record<string, unknown> | undefined;
  const name = asText(author?.["global_name"], asText(author?.["username"], "unknown"));
  const id = asText(author?.["id"]);
  return `${name}${id === "" ? "" : ` (${id})`}`;
}

/** The attachment notes of a message, such as ` [attachment: photo.png]`. */
function attachmentsOf(message: Record<string, unknown>): string {
  const attachments =
    (message["attachments"] as readonly Record<string, unknown>[] | undefined) ?? [];
  return attachments
    .map((attachment) => ` [attachment: ${asText(attachment["name"], "file")}]`)
    .join("");
}

/** A message as one line the model can read. */
function formatMessage(message: Record<string, unknown>): string {
  const raw = asText(message["content"]);
  const content = raw.length <= CONTENT_MAX ? raw : `${raw.slice(0, CONTENT_MAX)}…`;
  return `[${asText(message["timestamp"])}] ${authorOf(message)}: ${content}${attachmentsOf(message)}`;
}

const CHANNEL_TYPES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
  16: "media",
};

/** What one action runs with: the config, the HTTP client, the gates, and the caller's channel. */
type Deps = {
  readonly config: WorkerConfig;
  readonly fetchImpl: typeof fetch;
  readonly adminAllowed: boolean;
  /** The calling conversation's channel id, or an error when it has none. */
  readonly defaultChannel: () => Promise<string>;
};

/** The admin actions, exposed only when the config allows them. */
const ADMIN_ACTIONS: ReadonlySet<ActionArgs["action"]> = new Set([
  "pin_message",
  "unpin_message",
  "delete_message",
  "create_thread",
  "add_reaction",
]);

/** The default guild: the first one the bot is a member of. */
async function defaultGuildId(deps: Deps): Promise<string> {
  const guilds = (await call(deps.config, deps.fetchImpl, "/users/@me/guilds", "GET")) as
    readonly { id?: unknown }[] | undefined;
  const first = asText(guilds?.[0]?.id);
  if (first === "") throw new Error("the bot is not in any server");
  return first;
}

async function fetchMessages(args: ActionArgs, deps: Deps): Promise<string> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const channelId =
    args.channel_id === undefined
      ? await deps.defaultChannel()
      : requireSnowflake(args.channel_id, "channel_id");
  const before =
    args.before === undefined ? "" : `&before=${requireSnowflake(args.before, "before")}`;
  const messages = (await call(
    deps.config,
    deps.fetchImpl,
    `/channels/${channelId}/messages?limit=${limit}${before}`,
    "GET",
  )) as readonly Record<string, unknown>[];
  const lines = [...messages].reverse().map(formatMessage);
  if (lines.length === 0) return "No messages found.";
  const oldestId = asText(messages[messages.length - 1]?.["id"]);
  const more = messages.length === limit ? ` Older history: continue with before=${oldestId}.` : "";
  return `The last ${lines.length} message${lines.length === 1 ? "" : "s"} in ${channelId}, oldest first:\n${lines.join("\n")}${more}`;
}

async function listChannels(args: ActionArgs, deps: Deps): Promise<string> {
  const guildId = args.guild_id ?? (await defaultGuildId(deps));
  const channels = (await call(
    deps.config,
    deps.fetchImpl,
    `/guilds/${guildId}/channels`,
    "GET",
  )) as readonly Record<string, unknown>[];
  const lines = channels.map((channel) => {
    const kind = CHANNEL_TYPES[Number(channel["type"] ?? -1)] ?? "unknown";
    return `${kind} ${asText(channel["name"])} (${asText(channel["id"])})`;
  });
  return lines.length === 0 ? "No channels found." : lines.join("\n");
}

async function setPin(args: ActionArgs, deps: Deps, pin: boolean): Promise<string> {
  const channelId = requireSnowflake(args.channel_id, "channel_id");
  const messageId = requireSnowflake(args.message_id, "message_id");
  await call(
    deps.config,
    deps.fetchImpl,
    `/channels/${channelId}/pins/${messageId}`,
    pin ? "PUT" : "DELETE",
  );
  return `${pin ? "Pinned" : "Unpinned"} ${messageId} in ${channelId}.`;
}

async function deleteMessage(args: ActionArgs, deps: Deps): Promise<string> {
  const channelId = requireSnowflake(args.channel_id, "channel_id");
  const messageId = requireSnowflake(args.message_id, "message_id");
  await call(deps.config, deps.fetchImpl, `/channels/${channelId}/messages/${messageId}`, "DELETE");
  return `Deleted ${messageId} in ${channelId}.`;
}

async function createThread(args: ActionArgs, deps: Deps): Promise<string> {
  const channelId = requireSnowflake(args.channel_id, "channel_id");
  const messageId = requireSnowflake(args.message_id, "message_id");
  const name = (args.name ?? "").trim();
  if (name === "") throw new Error("name must name the new thread");
  const thread = (await call(
    deps.config,
    deps.fetchImpl,
    `/channels/${channelId}/messages/${messageId}/threads`,
    "POST",
    { name },
  )) as Record<string, unknown>;
  return `Created thread “${name}” (${asText(thread["id"])}).`;
}

async function addReaction(args: ActionArgs, deps: Deps): Promise<string> {
  const channelId = requireSnowflake(args.channel_id, "channel_id");
  const messageId = requireSnowflake(args.message_id, "message_id");
  const emoji = (args.emoji ?? "").trim();
  if (emoji === "") throw new Error("emoji must name the reaction, such as 👍");
  await call(
    deps.config,
    deps.fetchImpl,
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    "PUT",
  );
  return `Reacted ${emoji} to ${messageId}.`;
}

/** One action's work: the arguments in, the reply text out. */
type Action = (args: ActionArgs, deps: Deps) => Promise<string>;

/** The action table, keyed by the tool's action parameter. */
const ACTIONS: Record<ActionArgs["action"], Action> = {
  add_reaction: (args, deps) => addReaction(args, deps),
  create_thread: (args, deps) => createThread(args, deps),
  delete_message: (args, deps) => deleteMessage(args, deps),
  fetch_messages: (args, deps) => fetchMessages(args, deps),
  list_channels: (args, deps) => listChannels(args, deps),
  pin_message: (args, deps) => setPin(args, deps, true),
  unpin_message: (args, deps) => setPin(args, deps, false),
};

/** The calling conversation's channel id, from its chat key. */
function channelFromKey(chatKey: string | undefined): string {
  const id = chatKey?.startsWith("discord:") === true ? chatKey.slice(8) : undefined;
  if (id === undefined || !isSnowflake(id)) {
    throw new Error("this conversation has no channel; pass channel_id");
  }
  return id;
}

/** The Discord tool: one tool, an action parameter, read actions for all and admin actions behind the config flag. */
export function createDiscordTool(options: {
  readonly config: WorkerConfig;
  /** The chat key of the calling conversation, such as `discord:123`; undefined when it has none. */
  readonly channelOf: (conversationId: number) => Promise<string | undefined>;
  /** Direct fetch replacement for tests. */
  readonly fetchImpl?: typeof fetch;
}): ToolRegistration<typeof schema> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const adminAllowed = options.config.discord.agentTools?.admin === true;
  return defineTool({
    name: "discord",
    description:
      "Look up Discord state and act on it: read a channel's recent messages, list a server's channels, and, when admin actions are enabled, pin or delete messages, start threads, and react. Use it when a question needs messages you cannot see in this conversation.",
    parameters: schema,
    outputLimits: { maxBytes: 20_000 },
    async execute(args, api) {
      try {
        if (ADMIN_ACTIONS.has(args.action) && !adminAllowed) {
          throw new Error(
            `the ${args.action} action is admin-only; enable discord.agentTools.admin first`,
          );
        }
        const text = await ACTIONS[args.action](args, {
          adminAllowed,
          config: options.config,
          defaultChannel: async () => channelFromKey(await options.channelOf(api.conversationId)),
          fetchImpl,
        });
        return { output: [{ type: "text", text }] };
      } catch (error) {
        return { output: [{ type: "text", text: (error as Error).message }], isError: true };
      }
    },
  });
}
