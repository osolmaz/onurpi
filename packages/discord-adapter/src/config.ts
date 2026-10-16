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
  /** Answer direct messages from an owner. */
  readonly directMessages: boolean;
  /** Servers by id. The agent answers only in the channels listed under a server. */
  readonly guilds: Readonly<Record<string, GuildConfig>>;
};

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

function snowflakes(value: unknown, path: string): readonly string[] {
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
  const ownerIds = snowflakes(input["ownerIds"], `${path}.ownerIds`);
  if (ownerIds.length === 0) throw new Error(`${path}.ownerIds must name at least one owner`);
  const guilds = Object.entries(record(input["guilds"] ?? {}, `${path}.guilds`)).map(
    ([id, guild]) => {
      const at = `${path}.guilds.${id}`;
      return [snowflake(id, at), parseGuild(guild, at)] as const;
    },
  );
  return {
    directMessages: flag(input["directMessages"], `${path}.directMessages`, true),
    guilds: Object.fromEntries(guilds),
    ownerIds,
  };
}

/** True when some enabled channel answers messages that do not mention the bot. */
export function answersWithoutMention(config: AdapterConfig): boolean {
  return Object.values(config.guilds).some((guild) =>
    Object.values(guild.channels).some((channel) => channel.enabled && !channel.requireMention),
  );
}
