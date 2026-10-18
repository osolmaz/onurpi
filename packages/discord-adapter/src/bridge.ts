import { acceptMessage, conversationKey } from "./access.ts";
import { splitForDiscord } from "./chunks.ts";
import { ProgressEditor } from "./progress.ts";
import type { AdapterConfig } from "./config.ts";
import type {
  AgentPort,
  AgentReply,
  BridgeLog,
  ChatTransport,
  InboundMessage,
  ReplyLedger,
} from "./types.ts";

/** Discord shows a typing indicator for about 10 seconds, so the bridge sends it again sooner. */
export const TYPING_INTERVAL_MS = 8000;

/** How many missed messages the bridge reads per channel after a restart. */
export const MISSED_MESSAGE_LIMIT = 100;

export type { BridgeLog } from "./types.ts";

/**
 * What an intercept makes of an accepted message: a direct reply without the agent, or other text
 * for the agent, optionally for another conversation.
 */
export type Interception =
  { readonly reply: string } | { readonly text: string; readonly conversationKey?: string };

export type BridgeOptions = {
  readonly transport: ChatTransport;
  readonly agent: AgentPort;
  readonly config: AdapterConfig;
  readonly ledger: ReplyLedger;
  readonly log: BridgeLog;
  readonly typingIntervalMs?: number;
  /** Sees each accepted message first, for commands such as approvals. */
  readonly intercept?: (message: InboundMessage, text: string) => Promise<Interception | undefined>;
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
  private readonly intercept: BridgeOptions["intercept"];
  private readonly pending = new Set<Promise<void>>();

  constructor(options: BridgeOptions) {
    this.transport = options.transport;
    this.agent = options.agent;
    this.config = options.config;
    this.ledger = options.ledger;
    this.log = options.log;
    this.typingIntervalMs = options.typingIntervalMs ?? TYPING_INTERVAL_MS;
    this.intercept = options.intercept;
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
    const interception = await this.intercept?.(message, text);
    if (interception !== undefined && "reply" in interception) {
      await this.transport.send(message.channelId, interception.reply, message.id);
      await this.ledger.answered(message.id);
      this.log("intercepted", { message: message.id });
      return;
    }
    await this.reply(message, interception?.text ?? text, interception?.conversationKey);
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

  private async reply(
    message: InboundMessage,
    text: string,
    key = conversationKey(message),
  ): Promise<void> {
    await this.acknowledge(message);
    const editor =
      this.config.progress === undefined
        ? undefined
        : new ProgressEditor({
            channelId: message.channelId,
            intervalMs: this.config.progress.intervalMs,
            log: this.log,
            replyTo: message.id,
            transport: this.transport,
          });
    const reply = await this.whileTyping(message, () =>
      this.agent.ask(
        { conversationKey: key, requestId: `discord:${message.id}`, text },
        editor === undefined
          ? undefined
          : (progress) => {
              editor.note(progress.label);
            },
      ),
    );
    const answer =
      reply.kind === "answer" ? reply.text : `Sorry, I could not answer: ${reply.reason}`;
    await this.post(message, editor, answer);
    await this.dismiss(message);
    await this.ledger.answered(message.id);
    this.log("answered", { message: message.id, outcome: reply.kind });
  }

  /** Posts the answer, into the progress message when it exists, otherwise as a fresh reply. */
  private async post(
    message: InboundMessage,
    editor: ProgressEditor | undefined,
    answer: string,
  ): Promise<void> {
    const [first, ...rest] = splitForDiscord(answer);
    if (editor?.posted) await editor.finish(first ?? answer);
    else await this.transport.send(message.channelId, first ?? answer, message.id);
    for (const chunk of rest) await this.transport.send(message.channelId, chunk);
  }

  /** Reacts to the message the agent is about to answer, so the owner sees it was picked up. */
  private async acknowledge(message: InboundMessage): Promise<void> {
    const emoji = this.config.ackReaction;
    if (emoji === undefined) return;
    try {
      await this.transport.react?.(message.channelId, message.id, emoji);
    } catch (error) {
      this.log("react_failed", { message: message.id, error: String(error) });
    }
  }

  /** Removes the acknowledgment, because the answer is in. */
  private async dismiss(message: InboundMessage): Promise<void> {
    const emoji = this.config.ackReaction;
    if (emoji === undefined) return;
    try {
      await this.transport.unreact?.(message.channelId, message.id, emoji);
    } catch (error) {
      this.log("unreact_failed", { message: message.id, error: String(error) });
    }
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
