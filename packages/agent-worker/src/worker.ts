import {
  connectDiscord,
  DiscordBridge,
  type BridgeLog,
  type DiscordTransport,
} from "@onurpi/discord-adapter";
import { openAgent, type RunningAgent } from "./agent.ts";
import type { WorkerConfig } from "./config.ts";
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
  const agent = await openAgent(config, workerModels(config.model.provider));
  let transport: DiscordTransport;
  try {
    transport = await dependencies.connect(token, config.discord.messageContent);
  } catch (error) {
    await agent.close();
    throw error;
  }
  const bridge = new DiscordBridge(transport, agent, config.discord, dependencies.log);
  bridge.start();
  dependencies.log("ready", {
    bot: transport.botUserId,
    model: `${config.model.provider}/${config.model.modelId}`,
  });
  const stop = async () => {
    await bridge.idle();
    await transport.close();
    await agent.close();
  };
  return { agent, bridge, stop };
}
