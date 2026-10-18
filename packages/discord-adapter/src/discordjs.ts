import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  Partials,
  type SendableChannels,
} from "discord.js";
import type { ChatTransport, InboundMessage } from "./types.ts";

export type DiscordTransportOptions = {
  readonly token: string;
  /** Request the privileged Message Content intent. It must be turned on in the Developer Portal. */
  readonly messageContent: boolean;
};

export type DiscordTransport = ChatTransport & { close(): Promise<void> };

function toInbound(message: Message, botUserId: string): InboundMessage {
  const channel = message.channel;
  return {
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    channelId: message.channelId,
    guildId: message.guildId,
    content: message.content,
    id: message.id,
    isDirect: channel.type === ChannelType.DM,
    mentionsBot: message.mentions.users.has(botUserId),
    parentChannelId: channel.isThread() ? channel.parentId : null,
  };
}

async function sendable(client: Client, channelId: string): Promise<SendableChannels> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Discord channel ${channelId} cannot receive messages`);
  }
  return channel;
}

/** Connects to the Discord gateway with discord.js and resolves once the bot is ready. */
export async function connectDiscord(options: DiscordTransportOptions): Promise<DiscordTransport> {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    ...(options.messageContent ? [GatewayIntentBits.MessageContent] : []),
  ];
  const client = new Client({ intents, partials: [Partials.Channel] });
  const ready = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(options.token);
  const readyClient = await ready;
  const botUserId = readyClient.user.id;
  return {
    botUserId,
    close: () => client.destroy(),
    onMessage: (handler) => {
      client.on(Events.MessageCreate, (message) => {
        handler(toInbound(message, botUserId));
      });
    },
    send: async (channelId, text, replyTo) => {
      const channel = await sendable(client, channelId);
      const sent = await channel.send({
        allowedMentions: { parse: [] },
        content: text,
        ...(replyTo === undefined ? {} : { reply: { messageReference: replyTo } }),
      });
      return sent.id;
    },
    startTyping: async (channelId) => {
      await (await sendable(client, channelId)).sendTyping();
    },
    fetchAfter: async (channelId, afterId, limit) => {
      const messages = await (
        await sendable(client, channelId)
      ).messages.fetch({ after: afterId, limit });
      return [...messages.values()]
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((message) => toInbound(message, botUserId));
    },
    hasReply: async (channelId, messageId) => {
      const later = await (
        await sendable(client, channelId)
      ).messages.fetch({ after: messageId, limit: 100 });
      return later.some(
        (message) => message.author.id === botUserId && message.reference?.messageId === messageId,
      );
    },
    edit: async (channelId, messageId, text) => {
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      await message.edit({ allowedMentions: { parse: [] }, content: text });
    },
    react: async (channelId, messageId, emoji) => {
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      await message.react(emoji);
    },
    unreact: async (channelId, messageId, emoji) => {
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      const reaction = message.reactions.cache.find((item) => item.emoji.name === emoji);
      await reaction?.remove();
    },
  };
}
