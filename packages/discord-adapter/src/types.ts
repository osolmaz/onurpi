/** A Discord message as the adapter sees it, independent of the Discord client library. */
export type InboundMessage = {
  readonly id: string;
  readonly channelId: string;
  /** The parent channel of a thread, or null for a channel that is not a thread. */
  readonly parentChannelId: string | null;
  readonly isDirect: boolean;
  readonly authorId: string;
  readonly authorIsBot: boolean;
  readonly content: string;
  /** True when the message mentions the adapter's own bot user. */
  readonly mentionsBot: boolean;
};

/** What the adapter needs from Discord. The live implementation uses discord.js. */
export type ChatTransport = {
  readonly botUserId: string;
  onMessage(handler: (message: InboundMessage) => void): void;
  startTyping(channelId: string): Promise<void>;
  /** Posts a message and returns its id. */
  send(channelId: string, text: string, replyTo?: string): Promise<string>;
  edit(channelId: string, messageId: string, text: string): Promise<void>;
};

/** One question for the agent. `requestId` makes a repeated question return the first answer. */
export type AgentRequest = {
  readonly conversationKey: string;
  readonly requestId: string;
  readonly text: string;
};

export type AgentReply =
  | { readonly kind: "answer"; readonly text: string }
  | { readonly kind: "failed"; readonly reason: string };

/** What the adapter needs from the agent. The worker implements it with Pi Durable. */
export type AgentPort = {
  ask(request: AgentRequest): Promise<AgentReply>;
};
