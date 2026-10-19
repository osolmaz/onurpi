/** How the adapter logs: one line per event, as the worker's log keeps them. */
export type BridgeLog = (event: string, details: Readonly<Record<string, string>>) => void;

/** One file attached to an inbound message, as Discord reports it. */
export type InboundAttachment = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** What Discord says the file is, or null when it does not know. */
  readonly contentType: string | null;
  readonly size: number;
};

/** A Discord message as the adapter sees it, independent of the Discord client library. */
export type InboundMessage = {
  readonly id: string;
  readonly channelId: string;
  /** The server of the channel, or null for a direct message. */
  readonly guildId: string | null;
  /** The parent channel of a thread, or null for a channel that is not a thread. */
  readonly parentChannelId: string | null;
  readonly isDirect: boolean;
  readonly authorId: string;
  readonly authorIsBot: boolean;
  readonly content: string;
  /** True when the message mentions the adapter's own bot user. */
  readonly mentionsBot: boolean;
  /** The files attached to the message. Absent means none. */
  readonly attachments?: readonly InboundAttachment[];
};

/** What the adapter needs from Discord. The live implementation uses discord.js. */
export type ChatTransport = {
  readonly botUserId: string;
  onMessage(handler: (message: InboundMessage) => void): void;
  /** Shows that the bot is typing. Discord clears it after about 10 seconds or at the next message. */
  startTyping(channelId: string): Promise<void>;
  /** Posts a message and returns its id. */
  send(channelId: string, text: string, replyTo?: string): Promise<string>;
  /** Up to `limit` messages posted after `afterId` in a channel, oldest first. */
  fetchAfter(channelId: string, afterId: string, limit: number): Promise<readonly InboundMessage[]>;
  /** Whether the bot already replied to a message. */
  hasReply(channelId: string, messageId: string): Promise<boolean>;
  /** Reacts to a message. Absent when the transport cannot react. */
  react?(channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Removes the bot's own reaction. Absent when the transport cannot react. */
  unreact?(channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Replaces a posted message's text. Absent when the transport cannot edit. */
  edit?(channelId: string, messageId: string, text: string): Promise<void>;
};

/**
 * What the bridge keeps across restarts: the messages it accepted but has not answered yet, and the
 * newest message it saw in each channel. The worker stores it with the agent's other state.
 */
export type ReplyLedger = {
  accept(message: InboundMessage): Promise<void>;
  answered(messageId: string): Promise<void>;
  pending(): Promise<readonly InboundMessage[]>;
  /** Records a message id as seen. A position only moves forward. */
  seen(channelId: string, messageId: string): Promise<void>;
  positions(): Promise<Readonly<Record<string, string>>>;
};

/** One attachment the host saved where the agent's tools can read it. */
export type SavedAttachment = {
  readonly path: string;
  readonly name: string;
  readonly contentType: string | null;
};

/** One question for the agent. `requestId` makes a repeated question return the first answer. */
export type AgentRequest = {
  readonly conversationKey: string;
  readonly requestId: string;
  readonly text: string;
  /** The message's saved attachments. Absent means the message had none. */
  readonly attachments?: readonly SavedAttachment[];
};

/** One short note about what the agent is doing while it works on a request. */
export type AgentProgress = {
  readonly label: string;
};

/** Receives the progress notes of one running answer, when the adapter shows progress. */
export type ProgressSink = (progress: AgentProgress) => void;

export type AgentReply =
  | { readonly kind: "answer"; readonly text: string }
  | { readonly kind: "failed"; readonly reason: string };

/** What the adapter needs from the agent. The worker implements it with Pi Durable. */
export type AgentPort = {
  ask(request: AgentRequest, onProgress?: ProgressSink): Promise<AgentReply>;
};
