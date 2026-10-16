import { acceptMessage, conversationKey } from "./access.ts";
import { splitForDiscord } from "./chunks.ts";
import type { AdapterConfig } from "./config.ts";
import type { AgentPort, ChatTransport, InboundMessage } from "./types.ts";

export const WORKING_TEXT = "Working on it…";

export type BridgeLog = (event: string, details: Readonly<Record<string, string>>) => void;

/**
 * Connects Discord to the agent. Each accepted message becomes one agent request, keyed by the
 * Discord message id, so a message seen twice is answered once. The reply first appears as a
 * short placeholder, which is then replaced by the answer.
 */
export class DiscordBridge {
  private readonly transport: ChatTransport;
  private readonly agent: AgentPort;
  private readonly config: AdapterConfig;
  private readonly log: BridgeLog;
  private readonly pending = new Set<Promise<void>>();

  constructor(transport: ChatTransport, agent: AgentPort, config: AdapterConfig, log: BridgeLog) {
    this.transport = transport;
    this.agent = agent;
    this.config = config;
    this.log = log;
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
    await this.transport.startTyping(message.channelId);
    const placeholder = await this.transport.send(message.channelId, WORKING_TEXT, message.id);
    const reply = await this.agent.ask({
      conversationKey: conversationKey(message),
      requestId: `discord:${message.id}`,
      text,
    });
    const answer =
      reply.kind === "answer" ? reply.text : `Sorry, I could not answer: ${reply.reason}`;
    const [first, ...rest] = splitForDiscord(answer);
    await this.transport.edit(message.channelId, placeholder, first ?? answer);
    for (const chunk of rest) await this.transport.send(message.channelId, chunk);
    this.log("answered", { message: message.id, outcome: reply.kind });
  }
}
