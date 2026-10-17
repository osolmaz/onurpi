import { acceptMessage, conversationKey } from "./access.ts";
import { splitForDiscord } from "./chunks.ts";
import type { AdapterConfig } from "./config.ts";
import type { AgentPort, AgentReply, ChatTransport, InboundMessage, ReplyLedger } from "./types.ts";

/** Discord shows a typing indicator for about 10 seconds, so the bridge sends it again sooner. */
export const TYPING_INTERVAL_MS = 8000;

/** How many missed messages the bridge reads per channel after a restart. */
export const MISSED_MESSAGE_LIMIT = 100;

export type BridgeLog = (event: string, details: Readonly<Record<string, string>>) => void;

export type BridgeOptions = {
  readonly transport: ChatTransport;
  readonly agent: AgentPort;
  readonly config: AdapterConfig;
  readonly ledger: ReplyLedger;
  readonly log: BridgeLog;
  readonly typingIntervalMs?: number;
};

/**
 * Connects Discord to the agent. Each accepted message becomes one agent request, keyed by the
 * Discord message id, so a message seen twice is answered once. While the agent works, the bot
 * shows that it is typing. The answer is a reply to the message.
 *
 * On start, the bridge answers what an earlier process left: accepted messages without a reply,
 * then the messages that arrived in known channels while no process was running.
 */
export class DiscordBridge {
  private readonly transport: ChatTransport;
  private readonly agent: AgentPort;
  private readonly config: AdapterConfig;
  private readonly ledger: ReplyLedger;
  private readonly log: BridgeLog;
  private readonly typingIntervalMs: number;
  private readonly pending = new Set<Promise<void>>();

  constructor(options: BridgeOptions) {
    this.transport = options.transport;
    this.agent = options.agent;
    this.config = options.config;
    this.ledger = options.ledger;
    this.log = options.log;
    this.typingIntervalMs = options.typingIntervalMs ?? TYPING_INTERVAL_MS;
  }

  start(): void {
    this.transport.onMessage((message) => {
      this.track(this.receive(message), "reply_failed", message.id);
    });
    this.track(this.recover(), "recover_failed", "");
  }

  /** Resolves once every message that was being answered has its reply. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private track(work: Promise<void>, failure: string, messageId: string): void {
    const tracked = work.catch((error: unknown) => {
      this.log(failure, { message: messageId, error: String(error) });
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private async receive(message: InboundMessage): Promise<void> {
    await this.ledger.seen(message.channelId, message.id);
    const text = acceptMessage(message, this.config, this.transport.botUserId);
    if (text === null) return;
    this.log("accepted", { message: message.id, channel: message.channelId });
    await this.ledger.accept(message);
    await this.reply(message, text);
  }

  private async recover(): Promise<void> {
    for (const message of await this.ledger.pending()) {
      const text = acceptMessage(message, this.config, this.transport.botUserId);
      if (text === null || (await this.transport.hasReply(message.channelId, message.id))) {
        await this.ledger.answered(message.id);
        continue;
      }
      this.log("resumed", { message: message.id, channel: message.channelId });
      this.track(this.reply(message, text), "reply_failed", message.id);
    }
    for (const [channelId, after] of Object.entries(await this.ledger.positions())) {
      this.track(this.catchUp(channelId, after), "catch_up_failed", after);
    }
  }

  private async catchUp(channelId: string, after: string): Promise<void> {
    for (const message of await this.transport.fetchAfter(channelId, after, MISSED_MESSAGE_LIMIT)) {
      await this.receive(message);
    }
  }

  private async reply(message: InboundMessage, text: string): Promise<void> {
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
    await this.ledger.answered(message.id);
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
