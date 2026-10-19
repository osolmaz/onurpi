import { acceptMessage, conversationKey, splitQueuePrefix } from "./access.ts";
import { splitForDiscord } from "./chunks.ts";
import { DEFAULT_ATTACHMENT_LIMITS, type AdapterConfig } from "./config.ts";
import { ProgressEditor } from "./progress.ts";
import type {
  AgentPort,
  AgentReply,
  BridgeLog,
  ChatTransport,
  InboundAttachment,
  InboundMessage,
  ReplyLedger,
  SavedAttachment,
} from "./types.ts";

/** Discord shows a typing indicator for about 10 seconds, so the bridge sends it again sooner. */
export const TYPING_INTERVAL_MS = 8000;

/** How many missed messages the bridge reads per channel after a restart. */
export const MISSED_MESSAGE_LIMIT = 100;

export type { BridgeLog } from "./types.ts";

/** One run in flight: the messages it answers, its editor, and the answer it posted. */
type Run = {
  editor?: ProgressEditor | undefined;
  messages: InboundMessage[];
  answeredText?: string;
  dismissed?: boolean;
  steers: number;
  finished: boolean;
};

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
  /** Saves one attachment where the agent's tools can read it, and returns its path. */
  readonly download?: (attachment: InboundAttachment) => Promise<string>;
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
  private readonly download: BridgeOptions["download"];
  private readonly pending = new Set<Promise<void>>();
  /** Whether the last answered turn in a conversation came from a bot, not a person. */
  private readonly botTurns = new Map<string, boolean>();
  /** The runs in flight, by conversation key: what they answer and what they posted. */
  private readonly runs = new Map<string, Run>();
  /** The answer posts in flight, by conversation key, so a conversation posts in order. */
  private readonly posts = new Map<string, Promise<void>>();

  constructor(options: BridgeOptions) {
    this.transport = options.transport;
    this.agent = options.agent;
    this.config = options.config;
    this.ledger = options.ledger;
    this.log = options.log;
    this.typingIntervalMs = options.typingIntervalMs ?? TYPING_INTERVAL_MS;
    this.intercept = options.intercept;
    this.download = options.download;
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
    const verdict = this.verdict(message);
    if (verdict.kind === "ignore") {
      await this.ledger.seen(message.channelId, message.id);
      return;
    }
    this.log("accepted", { message: message.id, channel: message.channelId });
    await this.ledger.seen(message.channelId, message.id);
    await this.ledger.accept(message);
    if (verdict.kind === "steer") {
      await this.steer(verdict.run, verdict.key, message, verdict.prompt);
      return;
    }
    await this.deliver(
      message,
      verdict.key,
      verdict.prompt,
      verdict.kind === "start" ? verdict.run : undefined,
    );
  }

  /**
   * Decides what one message becomes, before any await, so two messages of one conversation agree
   * on which run each belongs to: a steer into the running turn, a queued follow-up, or a new run.
   */
  private verdict(
    message: InboundMessage,
  ):
    | { kind: "ignore" }
    | { kind: "queue"; key: string; prompt: string }
    | { kind: "steer" | "start"; key: string; prompt: string; run: Run } {
    const key = conversationKey(message);
    const text = acceptMessage(message, this.config, this.transport.botUserId);
    if (text === null) return { kind: "ignore" };
    if (this.suppressBotTurn(message, key)) return { kind: "ignore" };
    const { queued, text: prompt } = splitQueuePrefix(text);
    if (queued) return { kind: "queue", key, prompt };
    const run = this.runs.get(key);
    if (run !== undefined) return { kind: "steer", key, prompt, run };
    return { kind: "start", key, prompt, run: this.registerRun(key, message) };
  }

  /** Registers a new run for the conversation, before any await, so later messages steer it. */
  private registerRun(key: string, message: InboundMessage): Run {
    const entry: Run = { messages: [message], steers: 0, finished: false };
    this.runs.set(key, entry);
    return entry;
  }

  /** Hands a message to the running turn, so its answer covers the new message too. */
  private async steer(
    run: Run,
    key: string,
    message: InboundMessage,
    prompt: string,
  ): Promise<void> {
    run.messages.push(message);
    run.steers += 1;
    await this.acknowledge(message);
    const reply = await this.agent
      .ask({
        busyMode: "steer",
        conversationKey: key,
        requestId: `discord:${message.id}`,
        text: `${this.senderTag(message)}\n${prompt}`,
      })
      .catch((error: unknown) => {
        this.log("agent_failed", { message: message.id, error: String(error) });
        return undefined;
      })
      .finally(() => {
        run.steers -= 1;
      });
    const answer =
      reply === undefined
        ? undefined
        : reply.kind === "answer"
          ? reply.text
          : `Sorry, I could not answer: ${reply.reason}`;
    if (answer !== undefined) {
      await this.postAnswer(key, message, answer, undefined, run);
      this.log("answered", { message: message.id, outcome: reply?.kind ?? "steered" });
    }
    this.finishRun(key);
  }

  /** Posts one answer per conversation in order, once per distinct answer, and clears the eyes. */
  private async postAnswer(
    key: string,
    message: InboundMessage,
    answer: string,
    editor: ProgressEditor | undefined,
    run: Run | undefined,
  ): Promise<void> {
    const previous = this.posts.get(key) ?? Promise.resolve();
    const next = previous.then(() => this.postAll(key, message, answer, editor, run));
    this.posts.set(key, next);
    await next.finally(() => {
      if (this.posts.get(key) === next) this.posts.delete(key);
    });
  }

  /** The chained post: one answer per run, then the eyes come off every message it answered. */
  private async postAll(
    key: string,
    message: InboundMessage,
    answer: string,
    editor: ProgressEditor | undefined,
    run: Run | undefined,
  ): Promise<void> {
    if (run?.answeredText !== answer) await this.postOnce(run, message, answer, editor);
    if (run?.dismissed === true) return;
    await this.dismissAll(key, run?.messages ?? [message]);
    if (run !== undefined) run.dismissed = true;
  }

  /** Posts the run's answer once, as a reply to the newest message it answers. */
  private async postOnce(
    run: Run | undefined,
    message: InboundMessage,
    answer: string,
    editor: ProgressEditor | undefined,
  ): Promise<void> {
    if (run?.answeredText === answer) return;
    const target = (run?.messages ?? [message]).at(-1) ?? message;
    await this.post(target, editor, answer);
    if (run !== undefined) run.answeredText = answer;
  }

  /** Clears the eyes of every answered message and marks each one answered. */
  private async dismissAll(key: string, messages: readonly InboundMessage[]): Promise<void> {
    for (const item of messages) {
      await this.dismiss(item);
      await this.ledger.answered(item.id);
      this.botTurns.set(key, this.isBotTurn(item));
    }
  }

  /** Forgets a run once its answer is posted and no steer is still settling. */
  private finishRun(key: string): void {
    const run = this.runs.get(key);
    if (run?.finished === true && run.steers === 0) this.runs.delete(key);
  }

  /** Runs the intercept, then either posts its direct reply or lets the agent answer. */
  private async deliver(
    message: InboundMessage,
    key: string,
    text: string,
    entry: Run | undefined,
  ): Promise<void> {
    const saved = await this.saveAttachments(message);
    const prompt = this.withContext(message, this.promptWithAttachments(text, saved));
    const interception = await this.intercept?.(message, prompt);
    if (interception === undefined || !("reply" in interception)) {
      await this.reply(
        message,
        interception?.text ?? prompt,
        interception?.conversationKey,
        saved.attachments,
        entry,
      );
      return;
    }
    await this.transport.send(message.channelId, interception.reply, message.id);
    await this.ledger.answered(message.id);
    this.botTurns.set(key, this.isBotTurn(message));
    this.log("intercepted", { message: message.id });
  }

  /** The prompt text with one line per saved or skipped attachment. */
  private promptWithAttachments(
    text: string,
    saved: { readonly notes: readonly string[] },
  ): string {
    return saved.notes.length === 0
      ? text
      : `${text}\n\n<attachments>\n${saved.notes.join("\n")}\n</attachments>`;
  }

  /**
   * The prompt with the context lines saying where the message happened and who sent it, so the
   * transcript records the channel, server, sender, and time. Only a run's first prompt carries
   * the channel line; steered messages reuse the run's place and add their own sender line.
   */
  private withContext(message: InboundMessage, prompt: string): string {
    const place = message.isDirect
      ? "a direct message"
      : `#${message.channelName ?? message.channelId} in ${message.guildName ?? "a server"}`;
    return `[discord: ${place}, channel ${message.channelId}]\n${this.senderTag(message)}\n${prompt}`;
  }

  /** The line saying who sent a message and when, on every prompt the message produces. */
  private senderTag(message: InboundMessage): string {
    return `[from ${message.authorName ?? message.authorId} at ${message.sentAt ?? "an unknown time"}]`;
  }

  /** Saves the message's attachments within the configured limits, with one note per file. */
  private async saveAttachments(message: InboundMessage): Promise<{
    readonly attachments: readonly SavedAttachment[];
    readonly notes: readonly string[];
  }> {
    const list = message.attachments ?? [];
    const download = this.download;
    if (download === undefined || list.length === 0) return { attachments: [], notes: [] };
    const limits = this.config.attachments ?? DEFAULT_ATTACHMENT_LIMITS;
    const attachments: SavedAttachment[] = [];
    const notes: string[] = [];
    for (const attachment of list) {
      const outcome = await this.saveOne(attachment, attachments.length, limits, download);
      if (outcome.saved !== undefined) attachments.push(outcome.saved);
      notes.push(outcome.note);
    }
    return { attachments, notes };
  }

  /** Saves one attachment, or explains why it was skipped. */
  private async saveOne(
    attachment: InboundAttachment,
    savedCount: number,
    limits: { readonly maxBytes: number; readonly maxCount: number },
    download: (attachment: InboundAttachment) => Promise<string>,
  ): Promise<{ readonly note: string; readonly saved?: SavedAttachment }> {
    if (attachment.size > limits.maxBytes) {
      return { note: `${attachment.name}: skipped, larger than the ${limits.maxBytes} byte limit` };
    }
    if (savedCount >= limits.maxCount) {
      return { note: `${attachment.name}: skipped, at most ${limits.maxCount} files per message` };
    }
    try {
      const path = await download(attachment);
      const saved = { contentType: attachment.contentType, name: attachment.name, path };
      return { note: `${attachment.name} saved at ${path}`, saved };
    } catch (error) {
      return { note: `${attachment.name}: download failed (${String(error)})` };
    }
  }

  private async recover(): Promise<void> {
    for (const message of await this.ledger.pending()) {
      const text = acceptMessage(message, this.config, this.transport.botUserId);
      if (text === null || (await this.transport.hasReply(message.channelId, message.id))) {
        await this.ledger.answered(message.id);
        continue;
      }
      this.log("resumed", { message: message.id, channel: message.channelId });
      const saved = await this.saveAttachments(message);
      const key = conversationKey(message);
      this.track(
        this.reply(
          message,
          this.withContext(message, this.promptWithAttachments(text, saved)),
          key,
          saved.attachments,
          this.registerRun(key, message),
        ),
        "reply_failed",
        message.id,
      );
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
    attachments: readonly SavedAttachment[] = [],
    entry: Run | undefined,
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
    if (entry !== undefined) entry.editor = editor;
    try {
      const reply = await this.whileTyping(message, () =>
        this.agent.ask(
          {
            conversationKey: key,
            requestId: `discord:${message.id}`,
            text,
            ...(attachments.length === 0 ? {} : { attachments }),
            ...(entry === undefined
              ? { busyMode: "followUp" as const }
              : { busyMode: "steer" as const }),
          },
          editor === undefined
            ? undefined
            : (progress) => {
                editor.note(progress.label);
              },
        ),
      );
      const answer =
        reply.kind === "answer" ? reply.text : `Sorry, I could not answer: ${reply.reason}`;
      await this.postAnswer(key, message, answer, editor, entry);
      this.log("answered", { message: message.id, outcome: reply.kind });
    } finally {
      if (entry !== undefined) {
        entry.finished = true;
        this.finishRun(key);
      }
    }
  }

  /** The run entry a reply belongs to: its own run, or the run already in flight. */
  private entryFor(key: string, message: InboundMessage, queued: boolean): Run | undefined {
    if (queued) return undefined;
    const known = this.runs.get(key);
    if (known !== undefined) return known;
    const entry: Run = { messages: [message], steers: 0, finished: false };
    this.runs.set(key, entry);
    return entry;
  }

  /** Posts the answer, into the progress message when one was started, otherwise as a reply. */
  private async post(
    message: InboundMessage,
    editor: ProgressEditor | undefined,
    answer: string,
  ): Promise<void> {
    const [first, ...rest] = splitForDiscord(answer);
    if (editor?.started) {
      const edited = await editor.finish(first ?? answer).catch((error: unknown) => {
        this.log("progress_failed", { message: message.id, error: String(error) });
        return false;
      });
      if (!edited) await this.transport.send(message.channelId, first ?? answer, message.id);
    } else {
      await this.transport.send(message.channelId, first ?? answer, message.id);
    }
    for (const chunk of rest) await this.transport.send(message.channelId, chunk);
  }

  /**
   * Whether the bot turn must stay unanswered because the previous answered turn was a bot's: two
   * bots in a row would let two automations loop forever.
   */
  private suppressBotTurn(message: InboundMessage, key: string): boolean {
    if (!this.isBotTurn(message)) return false;
    if (this.botTurns.get(key) === true) {
      this.log("bot_suppressed", { message: message.id, channel: message.channelId });
      return true;
    }
    return false;
  }

  /** Whether the message came from a listed bot rather than a person or an owner. */
  private isBotTurn(message: InboundMessage): boolean {
    return message.authorIsBot && !this.config.ownerIds.includes(message.authorId);
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
