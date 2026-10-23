import { readFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { ImageContent, Message, Models, UserMessage } from "@earendil-works/pi-ai";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import {
  AssistantEntry,
  type AgentEvent,
  type CompactionResult,
  type Conversation,
  type ConversationId,
  createRegistry,
  defineDoc,
  defineDocFamily,
  defineExtension,
  Harness,
  type HarnessSettings,
  section,
  type EntryId,
  type SettledSubmissionRecord,
  type TaskOutcome,
  watchEvents,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type {
  AgentPort,
  AgentReply,
  AgentRequest,
  InboundMessage,
  ProgressSink,
  ReplyLedger,
  SavedAttachment,
} from "@onurpi/discord-adapter";
import { AntiRepeatWatcher, type AntiRepeatFeedback } from "./anti-repeat.ts";
import type { WorkerConfig } from "./config.ts";
import { createDiscordTool } from "./discord-tool.ts";
import {
  approvalsExtension,
  approvalStore,
  type ApprovalEvents,
  type ApprovalStore,
} from "./approvals.ts";
import type { JobLedger } from "./inbox.ts";
import { skillsExtension } from "./skills.ts";

const context = BACKGROUND_CONTEXT;

/** What a user turn may contain: text, or text with image blocks. */
type UserInput = UserMessage["content"];

/** Maps a chat key, such as `discord:<channel id>`, to the conversation that holds it. */
const ChatConversation = defineDocFamily<{ conversationId: ConversationId | 0 }, null>({
  family: true,
  // 0 means no conversation yet; Pi Durable ids start at 1.
  initial: () => ({ conversationId: 0 }),
  kind: "agent-worker.chat-conversation",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
});

/**
 * The instructions Pi would load: the `AGENTS.md` in the Pi agent folder, then one context file per
 * folder from the root down to the workspace. The format is Pi's, so the model sees the same text.
 * The files are read for every request, so an edit applies to the next answer.
 */
function instructions(config: WorkerConfig): string | undefined {
  const files = loadProjectContextFiles({ agentDir: config.agentDir, cwd: config.workspace });
  if (files.length === 0) return undefined;
  return [
    "Project-specific instructions and guidelines:",
    ...files.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
}

function answerText(message: Message | undefined): string {
  if (message?.role !== "assistant") return "";
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
}

type StoredMessage = Omit<InboundMessage, "attachments"> & { attachments?: StoredAttachment[] };

/** The attachment shape the ledger stores, JSON-ready. */
type StoredAttachment = {
  contentType: string | null;
  id: string;
  name: string;
  size: number;
  url: string;
};

/** What the Discord bridge keeps across restarts, committed with the conversations. */
const DiscordLedger = defineDoc<{
  pending: Record<string, StoredMessage>;
  positions: Record<string, string>;
}>({
  initial: () => ({ pending: {}, positions: {} }),
  kind: "agent-worker.discord-ledger",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
});

function discordLedger(harness: Harness): ReplyLedger {
  const read = async () =>
    (await harness.snapshot(DiscordLedger, context)) ?? { pending: {}, positions: {} };
  return {
    accept: (message) =>
      harness.commit(async (tx) => {
        const { attachments, ...rest } = message;
        const stored =
          attachments === undefined ? rest : { ...rest, attachments: [...attachments] };
        (await tx.doc(DiscordLedger)).pending[message.id] = stored;
      }, context),
    answered: (messageId) =>
      harness.commit(async (tx) => {
        const ledger = await tx.doc(DiscordLedger);
        ledger.pending = Object.fromEntries(
          Object.entries(ledger.pending).filter(([id]) => id !== messageId),
        );
      }, context),
    pending: async () => Object.values((await read()).pending),
    positions: async () => ({ ...(await read()).positions }),
    seen: (channelId, messageId) =>
      harness.commit(async (tx) => {
        const ledger = await tx.doc(DiscordLedger);
        const last = ledger.positions[channelId];
        if (last === undefined || BigInt(messageId) > BigInt(last))
          ledger.positions[channelId] = messageId;
      }, context),
  };
}

/** Which scheduled deliveries already have their answer in Discord. */
const JobPosts = defineDoc<{ posted: Record<string, string> }>({
  initial: () => ({ posted: {} }),
  kind: "agent-worker.job-posts",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
});

function jobLedger(harness: Harness): JobLedger {
  return {
    markPosted: (requestId, messageId) =>
      harness.commit(async (tx) => {
        (await tx.doc(JobPosts)).posted[requestId] = messageId;
      }, context),
    posted: async (requestId) => {
      const posts = await harness.snapshot(JobPosts, context);
      return posts !== undefined && requestId in posts.posted;
    },
  };
}

/** The chat key of each conversation, so a held call's card goes to the right channel. */
const ConversationKeys = defineDoc<{ keys: Record<string, string> }>({
  initial: () => ({ keys: {} }),
  kind: "agent-worker.conversation-keys",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
});

export type RunningAgent = AgentPort & {
  /** Approval requests for held tool calls. */
  readonly approvals: ApprovalStore;
  /** The chat key that a conversation belongs to. */
  chatKeyOf(conversationId: number): Promise<string | undefined>;
  /** The inbox's record of scheduled deliveries that already have their answer in Discord. */
  readonly jobs: JobLedger;
  /** The Discord bridge's record of unanswered messages and channel positions. */
  readonly ledger: ReplyLedger;
  /** Conversation that holds a chat key, created on first use. */
  conversationFor(key: string): Promise<ConversationId>;
  /** Resets the conversation: a new context, with `handoff` as its first message when given. */
  reset(key: string, handoff?: string): Promise<void>;
  /** Aborts the conversation's running turn and withdraws its queued inputs. */
  abort(key: string): Promise<void>;
  /** The active transcript's size, in entries and model messages. */
  inspect(key: string): Promise<{ entries: number; messages: number }>;
  /**
   * Summarizes the conversation's old prefix, keeping the recent context verbatim. Resolves once the
   * summary is placed, or once the compaction fails or finds nothing to compact.
   */
  compact(key: string, instructions?: string): Promise<CompactionOutcome>;
  close(): Promise<void>;
};

/** What a compaction did: the transcript sizes around it, and whether it placed a summary. */
export type CompactionOutcome = {
  readonly before: number;
  readonly after: number;
  readonly compacted: boolean;
  /** Why no summary was placed, when `compacted` is false. */
  readonly reason?: string;
};

/**
 * Opens the agent's storage and continues any work an earlier process left unfinished. Every
 * answer is committed before it is returned, so a crash between two steps loses nothing.
 */
export type AgentOptions = {
  /** Where held tool calls go. Without it, no call is held. */
  readonly approvals?: ApprovalEvents;
};

/** What one ask needs from the agent it talks to. */
type AskAgent = {
  readonly agent: {
    readonly cwd: string;
    readonly model: { readonly modelId: string; readonly provider: string };
  };
  readonly conversationFor: (key: string) => Promise<ConversationId>;
  readonly harness: Harness;
  readonly request: AgentRequest;
  readonly onProgress?: ProgressSink;
  readonly watchListener: (
    conversation: Conversation,
    watcher: AntiRepeatWatcher,
    seen: { feedback: AntiRepeatFeedback | null },
    onProgress?: ProgressSink,
  ) => (events: readonly AgentEvent[]) => Promise<void>;
  readonly watchers: Map<ConversationId, AntiRepeatWatcher>;
};

function watcherFor(watchers: Map<ConversationId, AntiRepeatWatcher>, id: ConversationId) {
  const known = watchers.get(id);
  if (known !== undefined) return known;
  const watcher = new AntiRepeatWatcher();
  watchers.set(id, watcher);
  return watcher;
}

/** The watch listener: run the policy, abort a repeating streamed response once, and note progress. */
function watchListener(
  conversation: Conversation,
  watcher: AntiRepeatWatcher,
  seen: { feedback: AntiRepeatFeedback | null },
  onProgress?: ProgressSink,
): (events: readonly AgentEvent[]) => Promise<void> {
  let aborting = false;
  return async (events) => {
    seen.feedback ??= watcher.feed(events);
    if (!aborting && seen.feedback?.activeResponse === true) {
      aborting = true;
      await conversation.abort(context).catch(() => undefined);
    }
    if (onProgress !== undefined) {
      const label = progressOf(events);
      if (label !== undefined) onProgress({ label });
    }
  };
}

/**
 * The one progress label a batch of events is about, or none. Later events in the batch win, so
 * the label names what the agent is doing now: thinking, writing, a tool call, or the text of an
 * intermediate answer.
 */
export function progressOf(events: readonly AgentEvent[]): string | undefined {
  let label: string | undefined;
  for (const event of events) label = progressOfEvent(event, label);
  return label;
}

/** The label one event contributes, on top of what earlier events in its batch already said. */
function progressOfEvent(event: AgentEvent, previous: string | undefined): string | undefined {
  if (event.type === "tool_execution_start") return toolLabel(event.toolName, event.args);
  if (event.type === "message_update") return changeLabel(event.changes, previous);
  if (event.type === "message_end") return assistantText(event.entry) ?? previous;
  return previous;
}

/** The newest activity one in-flight message shows: thinking, or writing its answer. */
function changeLabel(
  changes: readonly { readonly type: string }[],
  previous: string | undefined,
): string | undefined {
  let updated = previous;
  for (const change of changes) {
    if (change.type === "thinking_start" || change.type === "thinking_delta")
      updated = "\u{1F4AD} Thinking";
    else if (change.type === "text_start" || change.type === "text_delta")
      updated = "\u270D\uFE0F Writing";
  }
  return updated;
}

/** The first line of an intermediate assistant answer, shortened. */
function assistantText(entry: { readonly model?: readonly Message[] }): string | undefined {
  const message = entry.model?.at(-1);
  if (message?.role !== "assistant") return undefined;
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim();
  if (text.length === 0) return undefined;
  return `\u{1F4AC} ${shorten(text.split("\n", 1)[0] ?? text, 96)}`;
}

/** How a known tool call reads in the status line: an icon and the argument naming its target. */
const TOOL_LABELS: Readonly<
  Record<string, { readonly icon: string; readonly arg?: string; readonly base?: boolean }>
> = {
  bash: { icon: "\u{1F527}", arg: "command" },
  read: { icon: "\u{1F4D6}", arg: "path", base: true },
  write: { icon: "\u270D\uFE0F", arg: "path", base: true },
  edit: { icon: "\u270F\uFE0F", arg: "path", base: true },
  grep: { icon: "\u{1F50D}", arg: "pattern" },
  find: { icon: "\u{1F4C2}", arg: "pattern" },
  ls: { icon: "\u{1F4C2}", arg: "path" },
  web_search: { icon: "\u{1F310}", arg: "query" },
  fetch: { icon: "\u{1F4E5}", arg: "url" },
};

/** What a tool call is doing: an icon plus the file, command, or pattern it works on. */
function toolLabel(name: string, args: Record<string, unknown>): string {
  const known = TOOL_LABELS[name];
  const icon = known?.icon ?? "\u2699\uFE0F";
  const target = knownTarget(known, args) ?? fallbackTarget(args);
  const prefix = known === undefined ? `${name}: ` : "";
  return `${icon} ${prefix}${target}`;
}

/** The argument that names what a known tool call works on, shortened to a file name when asked. */
function knownTarget(
  known: { readonly arg?: string; readonly base?: boolean } | undefined,
  args: Record<string, unknown>,
): string | undefined {
  if (known?.arg === undefined) return undefined;
  const value = args[known.arg];
  if (typeof value !== "string" || value.length === 0) return undefined;
  const flat = shorten(value.replaceAll("\n", " ").trim(), 96);
  if (flat.length === 0) return undefined;
  return known.base === true ? flat.split("/").at(-1) : flat;
}

/** The target for an unknown tool: its first string argument, or the whole argument object. */
function fallbackTarget(args: Record<string, unknown>): string {
  const first = Object.values(args).find((value) => typeof value === "string" && value.length > 0);
  const head = typeof first === "string" ? first : JSON.stringify(args);
  return shorten(head.replaceAll("\n", " ").trim(), 96);
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** How long to wait between re-reads of an answer entry that has not grown text yet. */
const ANSWER_RETRY_MS = 250;
const ANSWER_RETRIES = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reads the answer entry for a settled submission. The settle event can outrun the entry's final
 * content commit while the answer streams in, so an empty text is re-read briefly before it is
 * taken at face value; a genuinely empty answer stays empty after the retries. Exported for tests.
 */
export async function answerOf(conversation: Conversation, answerId: EntryId): Promise<string> {
  for (let attempt = 0; attempt <= ANSWER_RETRIES; attempt += 1) {
    const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, answerId), context);
    const text = answerText(entry?.model?.[0]);
    if (text.length > 0) return text;
    if (attempt < ANSWER_RETRIES) await sleep(ANSWER_RETRY_MS);
  }
  return "";
}

/** Awaits one submission and turns its settled answer into a reply. */
async function replyOf(
  conversation: Conversation,
  submission: { wait(context: Context): Promise<SettledSubmissionRecord> },
): Promise<AgentReply> {
  const settled = await submission.wait(context);
  if (settled.type !== "input")
    throw new Error(`Pi Durable settled a ${settled.type} submission for an input`);
  if (settled.status !== "done") return { kind: "failed", reason: settled.reason };
  return { kind: "answer", text: await answerOf(conversation, settled.answer) };
}

/**
 * Submits one request and watches the conversation while it runs. The watcher sees the streamed
 * reasoning and the run boundaries; its "correct" decision submits one corrective follow-up, as
 * the Pi extension's default policy, and its "stop" decision leaves the answer aborted.
 */
/**
 * Builds the model input for one request: the prompt text, plus image attachments as image blocks
 * the model sees directly. Other files stay on disk; the prompt names their paths.
 */
export async function inputFor(request: AgentRequest): Promise<UserInput> {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) return request.text;
  const images: ImageContent[] = [];
  for (const attachment of attachments) {
    if (!isImage(attachment)) continue;
    images.push({
      mimeType: attachment.contentType ?? "image/png",
      type: "image",
      data: (await readFile(attachment.path)).toString("base64"),
    });
  }
  if (images.length === 0) return request.text;
  return [{ type: "text", text: request.text }, ...images];
}

function isImage(attachment: SavedAttachment): boolean {
  return (attachment.contentType ?? "").startsWith("image/");
}

/** Room kept free for the answer when the config does not say. */
const DEFAULT_RESERVE_TOKENS = 16384;

/**
 * The harness settings for this worker. `compaction.contextCeiling` is applied to the model's window
 * in `workerModels`, so the thresholds below are measured against the ceiling rather than the
 * provider's own limit.
 */
function harnessSettings(config: WorkerConfig): HarnessSettings {
  const compaction = config.compaction;
  if (compaction === undefined) return {};
  return {
    compaction: {
      ...(compaction.enabled === undefined ? {} : { enabled: compaction.enabled }),
      reserveTokens: compaction.reserveTokens ?? DEFAULT_RESERVE_TOKENS,
      ...(compaction.keepRecentTokens === undefined
        ? {}
        : { keepRecentTokens: compaction.keepRecentTokens }),
      ...(compaction.backgroundTokens === undefined
        ? {}
        : { backgroundTokens: compaction.backgroundTokens }),
    },
  };
}

/** Why a compaction task ended without placing a summary. */
function failureText(outcome: TaskOutcome<CompactionResult>): string {
  switch (outcome.status) {
    case "completed":
      return "the compaction did not finish";
    case "failed":
    case "faulted":
      return outcome.error.message;
    case "aborted":
      return outcome.reason ?? "the compaction was aborted";
    case "orphaned":
      return outcome.reason;
  }
}

/**
 * Summarizes a conversation's old prefix and reports the sizes around it. The task lands its summary
 * at once when the conversation is idle, or at the next boundary when a turn is running.
 */
async function compactConversation(
  harness: Harness,
  conversationId: ConversationId,
  instructions: string | undefined,
  context: Context,
): Promise<CompactionOutcome> {
  const conversation = await harness.conversation(conversationId, context);
  if (conversation === undefined) throw new Error("the conversation is missing");
  const before = (await conversation.context(context)).messages.length;
  const task = await conversation.compact(
    instructions === undefined || instructions.length === 0 ? undefined : instructions,
    context,
  );
  const outcome = (await harness.waitForTask(task, context)).state.outcome;
  const after = (await conversation.context(context)).messages.length;
  if (outcome.status !== "completed") {
    return { after, before, compacted: false, reason: failureText(outcome) };
  }
  const placed = outcome.result;
  return placed.entryId !== undefined || placed.submissionId !== undefined
    ? { after, before, compacted: true }
    : { after, before, compacted: false, reason: "nothing old enough to summarize" };
}

async function askAgent(ask: AskAgent): Promise<AgentReply> {
  const { agent, conversationFor, harness, request, watchListener, watchers } = ask;
  const conversationId = await conversationFor(request.conversationKey);
  const conversation = await harness.conversation(conversationId, context);
  if (conversation === undefined) return { kind: "failed", reason: "the conversation is missing" };
  await conversation.configure(agent, context);
  const watcher = watcherFor(watchers, conversationId);
  watcher.onNewInput(request.text);

  const watch = await watchEvents(harness, conversationId, context);
  const seen: { feedback: AntiRepeatFeedback | null } = { feedback: null };
  watch.start(watchListener(conversation, watcher, seen, ask.onProgress));
  const reply = await replyOf(
    conversation,
    await conversation.submit(
      {
        content: await inputFor(request),
        requestId: request.requestId,
        type: "input",
        ...(request.busyMode === undefined ? {} : { whenBusy: request.busyMode }),
      },
      context,
    ),
  );
  await watch.stop().catch(() => undefined);
  if (seen.feedback?.action !== "correct") return reply;
  // The corrective follow-up, with a request id that a retried delivery never runs twice.
  return replyOf(
    conversation,
    await conversation.submit(
      {
        content: watcher.correction(seen.feedback.detection),
        requestId: `${request.requestId}:anti-repeat`,
        type: "input",
      },
      context,
    ),
  );
}

export async function openAgent(
  config: WorkerConfig,
  models: Models,
  options: AgentOptions = {},
): Promise<RunningAgent> {
  const registry = createRegistry();
  registry.install(CodingTools);
  if (options.approvals !== undefined && config.approvals.held.length > 0) {
    registry.install(approvalsExtension(config.approvals.held, options.approvals));
  }
  registry.install(
    defineExtension({
      name: "agent-instructions",
      sections: [section("instructions-file", () => instructions(config), { tag: false })],
    }),
  );
  registry.install(skillsExtension(config.workspace));
  const chatKeyOf = async (conversationId: ConversationId): Promise<string | undefined> =>
    (await harness.snapshot(ConversationKeys, context))?.keys[String(conversationId)];
  registry.install(
    defineExtension({
      name: "discord",
      tools: [
        createDiscordTool({
          config,
          channelOf: (conversationId) => chatKeyOf(conversationId as ConversationId),
        }),
      ],
    }),
  );
  const storage = await openNodeSqliteStorage(config.storage);
  const env = ({ cwd = config.workspace }: { readonly cwd?: string }) =>
    new NodeExecutionEnv({ cwd });
  const settings = harnessSettings(config);
  const harness = await Harness.open(storage, { env, models, registry, settings }, context);
  harness.resume();
  const agent = {
    cwd: config.workspace,
    model: { modelId: config.model.modelId, provider: config.model.provider },
  };

  const conversationFor = async (key: string): Promise<ConversationId> =>
    harness.commit(async (tx) => {
      const record = await tx.doc(ChatConversation, key, null);
      if (record.conversationId === 0) {
        record.conversationId = (
          await tx.createConversation({ ownership: { kind: "ownerless" } })
        ).id;
      }
      const keys = await tx.doc(ConversationKeys);
      keys.keys[String(record.conversationId)] ??= key;
      return record.conversationId;
    }, context);

  // One Anti-Repeat watcher per conversation, kept across runs of that conversation.
  const watchers = new Map<ConversationId, AntiRepeatWatcher>();

  const ask = (request: AgentRequest, onProgress?: ProgressSink): Promise<AgentReply> =>
    askAgent({
      agent,
      conversationFor,
      harness,
      request,
      watchListener,
      watchers,
      ...(onProgress === undefined ? {} : { onProgress }),
    });

  return {
    ask,
    close: () => harness.close(context),
    conversationFor,
    approvals: approvalStore(harness),
    chatKeyOf,
    jobs: jobLedger(harness),
    ledger: discordLedger(harness),
    reset: async (key, handoff) => {
      const conversation = await harness.conversation(await conversationFor(key), context);
      if (conversation === undefined) throw new Error(`the conversation for ${key} is missing`);
      await conversation.reset(
        handoff === undefined || handoff.length === 0 ? undefined : handoff,
        context,
      );
    },
    abort: async (key) => {
      const conversation = await harness.conversation(await conversationFor(key), context);
      if (conversation === undefined) throw new Error(`the conversation for ${key} is missing`);
      await conversation.abort(context);
    },
    compact: async (key, instructions) =>
      compactConversation(harness, await conversationFor(key), instructions, context),
    inspect: async (key) => {
      const conversation = await harness.conversation(await conversationFor(key), context);
      if (conversation === undefined) throw new Error(`the conversation for ${key} is missing`);
      const view = await conversation.context(context);
      return { entries: view.entries.length, messages: view.messages.length };
    },
  };
}
