import type { AdapterConfig, ChannelConfig } from "./config.ts";
import type { InboundMessage } from "./types.ts";

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

/**
 * Returns the prompt text when the agent should answer the message, or null when it should ignore
 * it. Only owners are answered, never the bot itself, and only in allowed places.
 */
export function acceptMessage(
  message: InboundMessage,
  config: AdapterConfig,
  botUserId: string,
): string | null {
  if (message.authorId === botUserId) return null;
  if (!config.ownerIds.includes(message.authorId)) return null;
  const rule = placeRule(message, config);
  if (rule === null || (rule.requireMention && !message.mentionsBot)) return null;
  const text = message.content.replace(mentionPattern(botUserId), "").trim();
  return text.length === 0 ? null : text;
}

/** One conversation per direct-message channel, server channel, or thread. */
export function conversationKey(message: InboundMessage): string {
  return `discord:${message.channelId}`;
}
