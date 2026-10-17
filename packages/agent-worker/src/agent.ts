import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { Message, Models } from "@earendil-works/pi-ai";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import {
  AssistantEntry,
  type AgentEvent,
  type Conversation,
  type ConversationId,
  createRegistry,
  defineDoc,
  defineDocFamily,
  defineExtension,
  Harness,
  section,
  type SettledSubmissionRecord,
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
  ReplyLedger,
} from "@onurpi/discord-adapter";
import { AntiRepeatWatcher, type AntiRepeatFeedback } from "./anti-repeat.ts";
import type { WorkerConfig } from "./config.ts";
import {
  approvalsExtension,
  approvalStore,
  type ApprovalEvents,
  type ApprovalStore,
} from "./approvals.ts";
import type { JobLedger } from "./inbox.ts";
import { skillsExtension } from "./skills.ts";

const context = BACKGROUND_CONTEXT;

/** Maps a chat key, such as `discord:<channel id>`, to the conversation that holds it. */
const ChatConversation = defineDocFamily<{ conversationId: ConversationId | 0 }, null>({
  family: true,
  // 0 means no conversation yet; Pi Durable ids start at 1.
  initial: () => ({ conversationId: 0 }),
  kind: "agent-worker.chat-conversation",
  scope: "session",
  version: 1,
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

type StoredMessage = { [Key in keyof InboundMessage]: InboundMessage[Key] };

/** What the Discord bridge keeps across restarts, committed with the conversations. */
const DiscordLedger = defineDoc<{
  pending: Record<string, StoredMessage>;
  positions: Record<string, string>;
}>({
  initial: () => ({ pending: {}, positions: {} }),
  kind: "agent-worker.discord-ledger",
  scope: "session",
  version: 1,
});

function discordLedger(harness: Harness): ReplyLedger {
  const read = async () =>
    (await harness.snapshot(DiscordLedger, context)) ?? { pending: {}, positions: {} };
  return {
    accept: (message) =>
      harness.commit(async (tx) => {
        (await tx.doc(DiscordLedger)).pending[message.id] = { ...message };
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
  close(): Promise<void>;
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
  readonly watchListener: (
    conversation: Conversation,
    watcher: AntiRepeatWatcher,
    seen: { feedback: AntiRepeatFeedback | null },
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

/** The watch listener: run the policy, and abort a repeating streamed response once. */
function watchListener(
  conversation: Conversation,
  watcher: AntiRepeatWatcher,
  seen: { feedback: AntiRepeatFeedback | null },
): (events: readonly AgentEvent[]) => Promise<void> {
  let aborting = false;
  return async (events) => {
    seen.feedback ??= watcher.feed(events);
    if (!aborting && seen.feedback?.activeResponse === true) {
      aborting = true;
      await conversation.abort(context).catch(() => undefined);
    }
  };
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
  const entry = await conversation.commit(
    (tx) => tx.entry(AssistantEntry, settled.answer),
    context,
  );
  return { kind: "answer", text: answerText(entry?.model?.[0]) };
}

/**
 * Submits one request and watches the conversation while it runs. The watcher sees the streamed
 * reasoning and the run boundaries; its "correct" decision submits one corrective follow-up, as
 * the Pi extension's default policy, and its "stop" decision leaves the answer aborted.
 */
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
  watch.start(watchListener(conversation, watcher, seen));
  const reply = await replyOf(
    conversation,
    await conversation.submit(
      { content: request.text, requestId: request.requestId, type: "input" },
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
  const storage = await openNodeSqliteStorage(config.storage);
  const env = ({ cwd = config.workspace }: { readonly cwd?: string }) =>
    new NodeExecutionEnv({ cwd });
  const harness = await Harness.open(storage, { env, models, registry }, context);
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

  const ask = (request: AgentRequest): Promise<AgentReply> =>
    askAgent({
      agent,
      conversationFor,
      harness,
      request,
      watchListener,
      watchers,
    });

  return {
    ask,
    close: () => harness.close(context),
    conversationFor,
    approvals: approvalStore(harness),
    chatKeyOf: async (conversationId) =>
      (await harness.snapshot(ConversationKeys, context))?.keys[String(conversationId)],
    jobs: jobLedger(harness),
    ledger: discordLedger(harness),
  };
}
