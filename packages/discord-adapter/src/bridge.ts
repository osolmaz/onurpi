import { acceptMessage, conversationKey } from "./access.ts";
import { splitForDiscord } from "./chunks.ts";
import type { AdapterConfig } from "./config.ts";
import type { AgentPort, AgentReply, ChatTransport, InboundMessage } from "./types.ts";

/** Discord shows a typing indicator for about 10 seconds, so the bridge sends it again sooner. */
export const TYPING_INTERVAL_MS = 8000;

export type BridgeLog = (event: string, details: Readonly<Record<string, string>>) => void;

/**
 * Connects Discord to the agent. Each accepted message becomes one agent request, keyed by the
 * Discord message id, so a message seen twice is answered once. While the agent works, the bot
 * shows that it is typing. The answer is a reply to the message.
 */
export class DiscordBridge {
  private readonly transport: ChatTransport;
  private readonly agent: AgentPort;
  private readonly config: AdapterConfig;
  private readonly log: BridgeLog;
  private readonly typingIntervalMs: number;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    transport: ChatTransport,
    agent: AgentPort,
    config: AdapterConfig,
    log: BridgeLog,
    typingIntervalMs = TYPING_INTERVAL_MS,
  ) {
    this.transport = transport;
    this.agent = agent;
    this.config = config;
    this.log = log;
    this.typingIntervalMs = typingIntervalMs;
  }

  start(): void {
    this.transport.onMessage((message) => {
      const work = this.handle(message).catch((error: unknown) => {
        this.log("reply_failed", { message: message.id, error: String(error) });
      });
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    });
  }

  /** Resolves once every message that was being answered has its reply. */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async handle(message: InboundMessage): Promise<void> {
    const text = acceptMessage(message, this.config, this.transport.botUserId);
    if (text === null) return;
    this.log("accepted", { message: message.id, channel: message.channelId });
    const reply = await this.whileTyping(message, () =>
      this.agent.ask({
        conversationKey: conversationKey(message),
        requestId: `discord:${message.id}`,
        text,
      }),
    );
    const answer =
      reply.kind === "answer" ? reply.text : `Sorry, I could not answer: ${reply.reason}`;
    const [first, ...rest] = splitForDiscord(answer);
    await this.transport.send(message.channelId, first ?? answer, message.id);
    for (const chunk of rest) await this.transport.send(message.channelId, chunk);
    this.log("answered", { message: message.id, outcome: reply.kind });
  }

  /** Keeps the typing indicator on until the agent has answered or failed. */
  private async whileTyping(
    message: InboundMessage,
    ask: () => Promise<AgentReply>,
  ): Promise<AgentReply> {
    const type = () => {
      this.transport.startTyping(message.channelId).catch((error: unknown) => {
        this.log("typing_failed", { message: message.id, error: String(error) });
      });
    };
    type();
    const timer = setInterval(type, this.typingIntervalMs);
    try {
      return await ask();
    } catch (error) {
      this.log("agent_failed", { message: message.id, error: String(error) });
      return { kind: "failed", reason: "the agent stopped with an error" };
    } finally {
      clearInterval(timer);
    }
  }
}
