import {
  connectDiscord,
  DiscordBridge,
  type BridgeLog,
  type DiscordTransport,
} from "@onurpi/discord-adapter";
import { openAgent, type RunningAgent } from "./agent.ts";
import type { WorkerConfig } from "./config.ts";
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
  const agent = await openAgent(config, models.models);
  let transport: DiscordTransport;
  try {
    transport = await dependencies.connect(token, config.discord.messageContent);
  } catch (error) {
    await agent.close();
    models.close();
    throw error;
  }
  const bridge = new DiscordBridge({
    agent,
    config: config.discord,
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
        });
  inbox?.start();
  dependencies.log("ready", {
    bot: transport.botUserId,
    model: `${config.model.provider}/${config.model.modelId}`,
  });
  const stop = async () => {
    await inbox?.stop();
    await bridge.idle();
    await transport.close();
    await agent.close();
    models.close();
  };
  return { agent, bridge, stop };
}
