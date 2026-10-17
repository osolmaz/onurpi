import type {
  BridgeLog,
  ChatTransport,
  InboundMessage,
  Interception,
} from "@onurpi/discord-adapter";
import type { RunningAgent } from "./agent.ts";
import type { ApprovalEvents, ApprovalRequest } from "./approvals.ts";

/** What the desk needs from the agent. */
export type DeskAgent = Pick<RunningAgent, "approvals" | "chatKeyOf">;

const DECISION = /^(approve|reject)\s+#?(\d+)$/iu;
const SHOWN_COMMAND = 1500;

function card(id: string, request: ApprovalRequest): string {
  const command =
    request.command.length > SHOWN_COMMAND
      ? `${request.command.slice(0, SHOWN_COMMAND)}…`
      : request.command;
  return [
    `Approval needed, request ${id}: the agent wants to run \`${request.tool}\`:`,
    "```",
    command.replaceAll("```", "'''"),
    "```",
    `Reply \`approve ${id}\` or \`reject ${id}\`.`,
  ].join("\n");
}

/**
 * Posts an approval card for each held tool call and turns the owner's `approve <n>` or
 * `reject <n>` into a message for the conversation that holds the call. Held calls that come
 * before Discord is connected, such as from resumed work, wait until `attach`.
 */
export class ApprovalDesk implements ApprovalEvents {
  private readonly log: BridgeLog;
  private readonly fallbackChannel: string | undefined;
  private agent: DeskAgent | undefined;
  private transport: Pick<ChatTransport, "send"> | undefined;
  private readonly early: ApprovalRequest[] = [];
  private work: Promise<void> = Promise.resolve();

  constructor(log: BridgeLog, fallbackChannel?: string) {
    this.log = log;
    this.fallbackChannel = fallbackChannel;
  }

  attach(agent: DeskAgent, transport: Pick<ChatTransport, "send">): void {
    this.agent = agent;
    this.transport = transport;
    for (const request of this.early.splice(0)) this.requested(request);
  }

  /** Resolves once every card and decision so far is stored. */
  async idle(): Promise<void> {
    await this.work;
  }

  readonly requested = (request: ApprovalRequest): void => {
    if (this.agent === undefined) {
      this.early.push(request);
      return;
    }
    this.queue(() => this.open(request));
  };

  readonly used = (id: string): void => {
    this.queue(async () => {
      await this.agent?.approvals.decide(id, "used");
    });
  };

  readonly intercept = async (
    _message: InboundMessage,
    text: string,
  ): Promise<Interception | undefined> => {
    const match = DECISION.exec(text.trim());
    const agent = this.agent;
    if (match === null || agent === undefined) return undefined;
    const [, verb = "", id = ""] = match;
    await this.work;
    return this.decide(agent, id, verb.toLowerCase() === "approve");
  };

  private async decide(agent: DeskAgent, id: string, approved: boolean): Promise<Interception> {
    const request = await agent.approvals.get(id);
    if (request === undefined) return { reply: `There is no approval request ${id}.` };
    if (request.state !== "pending") return { reply: `Request ${id} is already ${request.state}.` };
    const decision = approved ? "approved" : "rejected";
    await agent.approvals.decide(id, decision);
    this.log("approval_decided", { decision, request: id });
    const note = approved
      ? `The owner approved request ${id}: \`${request.command}\`. Run exactly that call again now.`
      : `The owner rejected request ${id}: \`${request.command}\`. Do not run it, and do not try another way.`;
    const key = await agent.chatKeyOf(request.conversationId);
    return key === undefined ? { text: note } : { conversationKey: key, text: note };
  }

  private queue(step: () => Promise<void>): void {
    this.work = this.work.then(step).catch((error: unknown) => {
      this.log("approval_failed", { error: String(error) });
    });
  }

  private async open(request: ApprovalRequest): Promise<void> {
    const agent = this.agent;
    const transport = this.transport;
    if (agent === undefined || transport === undefined) return;
    const id = await agent.approvals.add(request);
    const key = await agent.chatKeyOf(request.conversationId);
    const channel =
      key?.startsWith("discord:") === true ? key.slice("discord:".length) : this.fallbackChannel;
    if (channel === undefined) {
      this.log("approval_unrouted", { request: id });
      return;
    }
    await transport.send(channel, card(id, request));
    this.log("approval_requested", { channel, request: id });
  }
}
