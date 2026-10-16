import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message, Models } from "@earendil-works/pi-ai";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import {
  AssistantEntry,
  type ConversationId,
  createRegistry,
  defineDocFamily,
  defineExtension,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { AgentPort, AgentReply, AgentRequest } from "@onurpi/discord-adapter";
import type { WorkerConfig } from "./config.ts";

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

export type RunningAgent = AgentPort & {
  /** Conversation that holds a chat key, created on first use. */
  conversationFor(key: string): Promise<ConversationId>;
  close(): Promise<void>;
};

/**
 * Opens the agent's storage and continues any work an earlier process left unfinished. Every
 * answer is committed before it is returned, so a crash between two steps loses nothing.
 */
export async function openAgent(config: WorkerConfig, models: Models): Promise<RunningAgent> {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    defineExtension({
      name: "agent-instructions",
      sections: [section("instructions-file", () => instructions(config), { tag: false })],
    }),
  );
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
      if (record.conversationId !== 0) return record.conversationId;
      const created = await tx.createConversation({ ownership: { kind: "ownerless" } });
      record.conversationId = created.id;
      return created.id;
    }, context);

  const ask = async (request: AgentRequest): Promise<AgentReply> => {
    const conversation = await harness.conversation(
      await conversationFor(request.conversationKey),
      context,
    );
    if (conversation === undefined)
      return { kind: "failed", reason: "the conversation is missing" };
    await conversation.configure(agent, context);
    const submission = await conversation.submit(
      { content: request.text, requestId: request.requestId, type: "input" },
      context,
    );
    const settled = await submission.wait(context);
    if (settled.type !== "input")
      throw new Error(`Pi Durable settled a ${settled.type} submission for an input`);
    if (settled.status !== "done") return { kind: "failed", reason: settled.reason };
    const entry = await conversation.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    return { kind: "answer", text: answerText(entry?.model?.[0]) };
  };

  return { ask, close: () => harness.close(context), conversationFor };
}
