import { PROGRESS_INTERVAL_MS } from "./progress.ts";

/** How the agent behaves in one server channel. A thread follows its parent channel. */
export type ChannelConfig = {
  /** Answer only messages that mention the bot. */
  readonly requireMention: boolean;
  /** False keeps the channel in the configuration but stops the agent from answering there. */
  readonly enabled: boolean;
};

/** The channels of one server where the agent answers. Channels that are not listed are ignored. */
export type GuildConfig = {
  readonly channels: Readonly<Record<string, ChannelConfig>>;
};

/** Who may talk to the agent, and where. */
export type AdapterConfig = {
  /** Discord user ids that may start a turn. Bots are ignored unless they are listed here. */
  readonly ownerIds: readonly string[];
  /** Bot user ids whose messages are answered like an owner's. Absent means every bot is ignored. */
  readonly bots?: readonly string[];
  /** Answer direct messages from an owner. */
  readonly directMessages: boolean;
  /** Servers by id. The agent answers only in the channels listed under a server. */
  readonly guilds: Readonly<Record<string, GuildConfig>>;
  /** Emoji the bot reacts with while a message is unanswered. Absent means no reaction. */
  readonly ackReaction?: string;
  /** Edit one status message with progress notes while the agent works. Absent means no edits. */
  readonly progress?: { readonly intervalMs: number };
  /** Attachment download limits. Absent means the defaults. */
  readonly attachments?: { readonly maxBytes: number; readonly maxCount: number };
};

/** The attachment limits used when the configuration names none. */
export const DEFAULT_ATTACHMENT_LIMITS = { maxBytes: 25 * 1024 * 1024, maxCount: 5 } as const;

const SNOWFLAKE = /^\d{17,20}$/u;

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function snowflake(value: string, path: string): string {
  if (!SNOWFLAKE.test(value))
    throw new Error(`${path} must be a Discord id given as a string of digits`);
  return value;
}

/** Reads a list of Discord ids, given as strings of digits. */
export function parseDiscordIds(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be a list of Discord ids`);
  return value.map((item, index) =>
    snowflake(typeof item === "string" ? item : "", `${path}[${index}]`),
  );
}

function flag(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${path} must be true or false`);
  return value;
}

function parseProgress(value: unknown, path: string): { intervalMs: number } | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return { intervalMs: PROGRESS_INTERVAL_MS };
  const input = record(value, path);
  const interval = input["intervalMs"];
  return {
    intervalMs:
      interval === undefined
        ? PROGRESS_INTERVAL_MS
        : Math.max(1000, wholeNumber(interval, `${path}.intervalMs`)),
  };
}

function wholeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a whole number`);
  }
  return value;
}

/** A whole number with a default, used for the attachment limits. */
function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  const number = wholeNumber(value, path);
  if (number === 0) throw new Error(`${path} must be above zero`);
  return number;
}

function parseChannel(value: unknown, path: string, requireMention: boolean): ChannelConfig {
  const input = record(value, path);
  return {
    enabled: flag(input["enabled"], `${path}.enabled`, true),
    requireMention: flag(input["requireMention"], `${path}.requireMention`, requireMention),
  };
}

function parseGuild(value: unknown, path: string): GuildConfig {
  const input = record(value, path);
  const requireMention = flag(input["requireMention"], `${path}.requireMention`, true);
  const channels = Object.entries(record(input["channels"] ?? {}, `${path}.channels`)).map(
    ([id, channel]) => {
      const at = `${path}.channels.${id}`;
      return [snowflake(id, at), parseChannel(channel, at, requireMention)] as const;
    },
  );
  return { channels: Object.fromEntries(channels) };
}

/** Reads and checks the adapter part of the worker configuration. */
export function parseAdapterConfig(value: unknown, path = "discord"): AdapterConfig {
  const input = record(value, path);
  const ownerIds = parseDiscordIds(input["ownerIds"], `${path}.ownerIds`);
  if (ownerIds.length === 0) throw new Error(`${path}.ownerIds must name at least one owner`);
  const bots = input["bots"] === undefined ? [] : parseDiscordIds(input["bots"], `${path}.bots`);
  const attachments =
    input["attachments"] === undefined
      ? undefined
      : parseAttachments(input["attachments"], `${path}.attachments`);
  const guilds = Object.entries(record(input["guilds"] ?? {}, `${path}.guilds`)).map(
    ([id, guild]) => {
      const at = `${path}.guilds.${id}`;
      return [snowflake(id, at), parseGuild(guild, at)] as const;
    },
  );
  return {
    ...(bots.length === 0 ? {} : { bots }),
    ...(attachments === undefined ? {} : { attachments }),
    ...presentation(input, path),
    directMessages: flag(input["directMessages"], `${path}.directMessages`, true),
    guilds: Object.fromEntries(guilds),
    ownerIds,
  };
}

/** Reads and checks the attachment limits. */
function parseAttachments(
  value: unknown,
  path: string,
): { readonly maxBytes: number; readonly maxCount: number } {
  const input = record(value, path);
  const maxBytes = positiveInteger(input["maxBytes"], `${path}.maxBytes`, 25 * 1024 * 1024);
  const maxCount = positiveInteger(input["maxCount"], `${path}.maxCount`, 5);
  return { maxBytes, maxCount };
}

/** The reaction and progress options, which only shape how an answer looks. */
function presentation(
  input: Readonly<Record<string, unknown>>,
  path: string,
): Partial<AdapterConfig> {
  const ack = input["ackReaction"];
  if (ack !== undefined && (typeof ack !== "string" || ack.length === 0)) {
    throw new Error(`${path}.ackReaction must be an emoji, such as "👀"`);
  }
  const progress = parseProgress(input["progress"], `${path}.progress`);
  return {
    ...(ack === undefined ? {} : { ackReaction: ack }),
    ...(progress === undefined ? {} : { progress }),
  };
}

/** True when some enabled channel answers messages that do not mention the bot. */
export function answersWithoutMention(config: AdapterConfig): boolean {
  return Object.values(config.guilds).some((guild) =>
    Object.values(guild.channels).some((channel) => channel.enabled && !channel.requireMention),
  );
}
