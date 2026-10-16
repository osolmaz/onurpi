/** Who may talk to the agent, and where. */
export type AdapterConfig = {
  /** Discord user ids that may start a turn. Bots are ignored unless they are listed here. */
  readonly ownerIds: readonly string[];
  /** Server channels where the agent answers. A thread follows its parent channel. */
  readonly channelIds: readonly string[];
  /** Answer direct messages from an owner. */
  readonly directMessages: boolean;
  /**
   * In server channels, answer only messages that mention the bot. Discord sends message text to a
   * bot without the Message Content intent only for direct messages and messages that mention it.
   */
  readonly requireMention: boolean;
};

const SNOWFLAKE = /^\d{17,20}$/u;

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function snowflakes(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be a list of Discord ids`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !SNOWFLAKE.test(item)) {
      throw new Error(`${path}[${index}] must be a Discord id given as a string of digits`);
    }
    return item;
  });
}

function flag(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${path} must be true or false`);
  return value;
}

/** Reads and checks the adapter part of the worker configuration. */
export function parseAdapterConfig(value: unknown, path = "discord"): AdapterConfig {
  const input = record(value, path);
  const ownerIds = snowflakes(input["ownerIds"], `${path}.ownerIds`);
  if (ownerIds.length === 0) throw new Error(`${path}.ownerIds must name at least one owner`);
  return {
    channelIds: snowflakes(input["channelIds"] ?? [], `${path}.channelIds`),
    directMessages: flag(input["directMessages"], `${path}.directMessages`, true),
    ownerIds,
    requireMention: flag(input["requireMention"], `${path}.requireMention`, true),
  };
}
