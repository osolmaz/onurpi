import type { AdapterConfig } from "./config.ts";
import type { InboundMessage } from "./types.ts";

function mentionPattern(botUserId: string): RegExp {
  return new RegExp(`<@!?${botUserId}>`, "gu");
}

function allowedPlace(message: InboundMessage, config: AdapterConfig): boolean {
  if (message.isDirect) return config.directMessages;
  const channel = message.parentChannelId ?? message.channelId;
  return config.channelIds.includes(channel);
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
  if (!allowedPlace(message, config)) return null;
  if (!message.isDirect && config.requireMention && !message.mentionsBot) return null;
  const text = message.content.replace(mentionPattern(botUserId), "").trim();
  return text.length === 0 ? null : text;
}

/** One conversation per direct-message channel, server channel, or thread. */
export function conversationKey(message: InboundMessage): string {
  return `discord:${message.channelId}`;
}
