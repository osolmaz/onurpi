import type { ClientOptions } from "discord.js";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  Partials,
  type SendableChannels,
} from "discord.js";
import type { ChatTransport, InboundAttachment, InboundMessage } from "./types.ts";

export type DiscordTransportOptions = {
  readonly token: string;
  /** Request the privileged Message Content intent. It must be turned on in the Developer Portal. */
  readonly messageContent: boolean;
  /**
   * Base URL of a REST relay that adds the bot token. When set, every REST call goes through it
   * instead of carrying the token (and its credential-rewrite middleware, which drops request
   * bodies past the sandbox's L7 path). The gateway websocket still uses the token directly.
   */
  readonly restProxy?: string;
};

/** Rewrites one discord.js REST call to run through the relay without a credential header. */
export function relayRequest(restProxy: string, url: string, init: RequestInit): Promise<Response> {
  const marker = "https://discord.com/api/v10/";
  if (!url.startsWith(marker)) {
    throw new Error(`REST url does not carry the Discord API path: ${url}`);
  }
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  return fetch(`${restProxy}/relay${url.slice(marker.length - 1)}`, { ...init, headers });
}

export type DiscordTransport = ChatTransport & { close(): Promise<void> };

function toInbound(message: Message, botUserId: string): InboundMessage {
  const channel = message.channel;
  return {
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    channelId: message.channelId,
    guildId: message.guildId,
    guildName: message.guild?.name ?? null,
    channelName: "name" in channel ? (channel.name ?? null) : null,
    authorName: message.member?.displayName ?? message.author.username,
    sentAt: message.createdAt.toISOString(),
    content: message.content,
    id: message.id,
    isDirect: channel.type === ChannelType.DM,
    mentionsBot: message.mentions.users.has(botUserId),
    parentChannelId: channel.isThread() ? channel.parentId : null,
    ...attachmentList(message),
  };
}

function attachmentList(message: Message): { attachments?: readonly InboundAttachment[] } {
  if (message.attachments.size === 0) return {};
  return {
    attachments: [...message.attachments.values()].map((attachment) => ({
      contentType: attachment.contentType ?? null,
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      url: attachment.url,
    })),
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
  const restProxy = options.restProxy;
  const client = new Client({
    intents,
    partials: [Partials.Channel],
    ...(restProxy === undefined
      ? {}
      : {
          // discord.js routes every REST call through here; the relay adds the token host-side.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- discord.js types the rest options against its own undici copy
          rest: {
            makeRequest: (url, init) =>
              relayRequest(restProxy, url, init as unknown as RequestInit),
          } as NonNullable<ClientOptions["rest"]>,
        }),
  });
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
      console.log(
        JSON.stringify({ event: "transport_send", chars: text.length, head: text.slice(0, 60) }),
      );
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
      console.log(
        JSON.stringify({ event: "transport_edit", chars: text.length, head: text.slice(0, 60) }),
      );
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      await message.edit({ allowedMentions: { parse: [] }, content: text });
    },
    react: async (channelId, messageId, emoji) => {
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      await message.react(emoji);
    },
    unreact: async (channelId, messageId, emoji) => {
      const message = await (await sendable(client, channelId)).messages.fetch(messageId);
      // Removes the bot's own reaction, which needs only Add Reactions; the emoji-wide route needs
      // Manage Messages, which the bot does not have.
      await message.reactions.cache
        .find((item) => item.emoji.name === emoji)
        ?.users.remove(botUserId);
    },
  };
}
