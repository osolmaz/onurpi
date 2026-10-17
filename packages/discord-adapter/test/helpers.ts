import type {
  AgentPort,
  AgentReply,
  AgentRequest,
  ChatTransport,
  InboundMessage,
  ReplyLedger,
} from "../src/types.ts";

export const BOT = "100000000000000001";
export const OWNER = "200000000000000002";
export const STRANGER = "300000000000000003";
export const GUILD = "700000000000000007";
export const CHANNEL = "400000000000000004";
export const OTHER_CHANNEL = "500000000000000005";

export function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    authorId: OWNER,
    authorIsBot: false,
    channelId: CHANNEL,
    content: `<@${BOT}> hello`,
    guildId: GUILD,
    id: "600000000000000006",
    isDirect: false,
    mentionsBot: true,
    parentChannelId: null,
    ...overrides,
  };
}

export type Posted = { channelId: string; id: string; text: string; replyTo?: string | undefined };

export class FakeTransport implements ChatTransport {
  readonly botUserId = BOT;
  readonly posted: Posted[] = [];
  readonly typing: string[] = [];
  private handler: ((message: InboundMessage) => void) | undefined;

  onMessage(handler: (message: InboundMessage) => void): void {
    this.handler = handler;
  }

  emit(inbound: InboundMessage): void {
    this.handler?.(inbound);
  }

  startTyping(channelId: string): Promise<void> {
    this.typing.push(channelId);
    return Promise.resolve();
  }

  send(channelId: string, text: string, replyTo?: string): Promise<string> {
    const id = `sent-${this.posted.length + 1}`;
    this.posted.push({ channelId, id, replyTo, text });
    return Promise.resolve(id);
  }

  /** Messages the channel holds, as `fetchAfter` returns them. */
  readonly history: InboundMessage[] = [];

  fetchAfter(
    channelId: string,
    afterId: string,
    limit: number,
  ): Promise<readonly InboundMessage[]> {
    return Promise.resolve(
      this.history
        .filter((item) => item.channelId === channelId && BigInt(item.id) > BigInt(afterId))
        .slice(0, limit),
    );
  }

  hasReply(_channelId: string, messageId: string): Promise<boolean> {
    return Promise.resolve(this.posted.some((item) => item.replyTo === messageId));
  }
}

/** A ledger kept in memory, as the worker keeps it in storage. */
export class FakeLedger implements ReplyLedger {
  readonly accepted = new Map<string, InboundMessage>();
  readonly seenIds = new Map<string, string>();

  accept(message: InboundMessage): Promise<void> {
    this.accepted.set(message.id, message);
    return Promise.resolve();
  }

  answered(messageId: string): Promise<void> {
    this.accepted.delete(messageId);
    return Promise.resolve();
  }

  pending(): Promise<readonly InboundMessage[]> {
    return Promise.resolve([...this.accepted.values()]);
  }

  seen(channelId: string, messageId: string): Promise<void> {
    const last = this.seenIds.get(channelId);
    if (last === undefined || BigInt(messageId) > BigInt(last))
      this.seenIds.set(channelId, messageId);
    return Promise.resolve();
  }

  positions(): Promise<Readonly<Record<string, string>>> {
    return Promise.resolve(Object.fromEntries(this.seenIds));
  }
}

export class FakeAgent implements AgentPort {
  readonly requests: AgentRequest[] = [];
  private readonly reply: (request: AgentRequest) => AgentReply;

  constructor(
    reply: (request: AgentRequest) => AgentReply = (request) => ({
      kind: "answer",
      text: `Echo: ${request.text}`,
    }),
  ) {
    this.reply = reply;
  }

  ask(request: AgentRequest): Promise<AgentReply> {
    this.requests.push(request);
    return Promise.resolve(this.reply(request));
  }
}

/** An adapter configuration that answers the owner in one channel of one server. */
export function oneChannel(
  channel: Record<string, unknown> = {},
  guild: Record<string, unknown> = {},
) {
  return { guilds: { [GUILD]: { ...guild, channels: { [CHANNEL]: channel } } }, ownerIds: [OWNER] };
}
