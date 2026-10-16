import type {
  AgentPort,
  AgentReply,
  AgentRequest,
  ChatTransport,
  InboundMessage,
} from "../src/types.ts";

export const BOT = "100000000000000001";
export const OWNER = "200000000000000002";
export const STRANGER = "300000000000000003";
export const CHANNEL = "400000000000000004";
export const OTHER_CHANNEL = "500000000000000005";

export function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    authorId: OWNER,
    authorIsBot: false,
    channelId: CHANNEL,
    content: `<@${BOT}> hello`,
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
