import type { AdapterConfig, ChannelConfig } from "./config.ts";
import type { InboundMessage } from "./types.ts";

/** Matches a leading request to queue instead of steering: `q …` or `queue …`. */
const QUEUE_PREFIX = /^(?:q|queue)\s+/i;

/** Splits a leading queue keyword off the prompt text. */
export function splitQueuePrefix(text: string): { queued: boolean; text: string } {
  const match = QUEUE_PREFIX.exec(text);
  return match === null
    ? { queued: false, text }
    : { queued: true, text: text.slice(match[0].length).trim() };
}

function mentionPattern(botUserId: string): RegExp {
  return new RegExp(`<@!?${botUserId}>`, "gu");
}

/** The configuration of the server channel a message is in, or undefined when it is not listed. */
function channelConfig(message: InboundMessage, config: AdapterConfig): ChannelConfig | undefined {
  if (message.guildId === null) return undefined;
  return config.guilds[message.guildId]?.channels[message.parentChannelId ?? message.channelId];
}

/** Whether the agent may answer in this place, and whether the message must mention the bot. */
function placeRule(
  message: InboundMessage,
  config: AdapterConfig,
): { readonly requireMention: boolean } | null {
  if (message.isDirect) return config.directMessages ? { requireMention: false } : null;
  const channel = channelConfig(message, config);
  return channel?.enabled === true ? { requireMention: channel.requireMention } : null;
}

/** Whether someone other than the bot itself may start a turn. */
function isAllowed(message: InboundMessage, config: AdapterConfig, botUserId: string): boolean {
  if (message.authorId === botUserId) return false;
  return (
    config.ownerIds.includes(message.authorId) || (config.bots ?? []).includes(message.authorId)
  );
}

/**
 * Returns the prompt text when the agent should answer the message, or null when it should ignore
 * it. Only owners and the bots named in the configuration are answered, and only in allowed places.
 */
export function acceptMessage(
  message: InboundMessage,
  config: AdapterConfig,
  botUserId: string,
): string | null {
  if (!isAllowed(message, config, botUserId)) return null;
  const rule = placeRule(message, config);
  if (rule === null || (rule.requireMention && !message.mentionsBot)) return null;
  const text = message.content.replace(mentionPattern(botUserId), "").trim();
  return text.length === 0 ? null : text;
}

/** One conversation per direct-message channel, server channel, or thread. */
export function conversationKey(message: InboundMessage): string {
  return `discord:${message.channelId}`;
}
