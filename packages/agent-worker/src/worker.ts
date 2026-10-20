import {
  connectDiscord,
  DiscordBridge,
  type BridgeLog,
  type DiscordTransport,
} from "@onurpi/discord-adapter";
import { pruneAttachments, saveAttachment, annotateAttachment } from "./attachments.ts";
import { openAgent, type RunningAgent } from "./agent.ts";
import { createCommandHandler } from "./commands.ts";
import type { WorkerConfig } from "./config.ts";
import { ApprovalDesk } from "./desk.ts";
import { Inbox } from "./inbox.ts";
import { workerModels } from "./models.ts";

export type Worker = {
  readonly agent: RunningAgent;
  readonly bridge: DiscordBridge;
  /** Lets running answers finish, then closes Discord and the storage. */
  stop(): Promise<void>;
};

export type WorkerDependencies = {
  readonly connect: (token: string, messageContent: boolean) => Promise<DiscordTransport>;
  readonly env: NodeJS.ProcessEnv;
  readonly log: BridgeLog;
};

export const defaultDependencies: WorkerDependencies = {
  connect: (token, messageContent) => connectDiscord({ messageContent, token }),
  env: process.env,
  log: (event, details) => {
    console.log(JSON.stringify({ event, ...details, time: new Date().toISOString() }));
  },
};

/** How often the attachment sweep runs: once a day. */
const ATTACHMENT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Opens the agent, connects to Discord, and starts answering. */
export async function startWorker(
  config: WorkerConfig,
  dependencies = defaultDependencies,
): Promise<Worker> {
  const token = dependencies.env[config.discord.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `Set the Discord bot token in the environment variable ${config.discord.tokenEnv}`,
    );
  }
  const models = workerModels(config.model, config.agentDir, dependencies.env);
  const desk = new ApprovalDesk(dependencies.log, config.approvals.channelId);
  const agent = await openAgent(config, models.models, { approvals: desk });
  let transport: DiscordTransport;
  try {
    transport = await dependencies.connect(token, config.discord.messageContent);
  } catch (error) {
    await agent.close();
    models.close();
    throw error;
  }
  desk.attach(agent, transport);
  const bridge = new DiscordBridge({
    agent,
    command: createCommandHandler({ agent, config }),
    config: config.discord,
    download: (attachment) => saveAttachment(config.workspace, attachment),
    annotate: (saved) => annotateAttachment(config, saved),
    intercept: desk.intercept,
    ledger: agent.ledger,
    log: dependencies.log,
    transport,
  });
  bridge.start();
  const inbox =
    config.inbox === undefined
      ? undefined
      : new Inbox({
          agent,
          channelIds: config.inbox.channelIds,
          folder: config.inbox.folder,
          ledger: agent.jobs,
          log: dependencies.log,
          transport,
          ...(config.inbox.suppress === undefined ? {} : { suppress: config.inbox.suppress }),
        });
  inbox?.start();
  const pruneTimer = startAttachmentSweep(config.workspace, dependencies.log);
  dependencies.log("ready", {
    bot: transport.botUserId,
    model: `${config.model.provider}/${config.model.modelId}`,
  });
  const stop = async () => {
    clearInterval(pruneTimer);
    await inbox?.stop();
    await bridge.idle();
    await desk.idle();
    await transport.close();
    await agent.close();
    models.close();
  };
  return { agent, bridge, stop };
}

/** Removes old attachments now and once a day; a failed sweep is logged and ignored. */
function startAttachmentSweep(workspace: string, log: BridgeLog): NodeJS.Timeout {
  const sweep = async () => {
    try {
      const removed = await pruneAttachments(workspace, Date.now());
      if (removed > 0) log("pruned", { count: String(removed) });
    } catch (error) {
      log("prune_failed", { error: String(error) });
    }
  };
  void sweep();
  const timer = setInterval(() => {
    void sweep();
  }, ATTACHMENT_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
