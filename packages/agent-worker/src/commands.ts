import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { RunningAgent } from "./agent.ts";
import type { WorkerConfig } from "./config.ts";
import { listWorkspaceSkills } from "./skills.ts";

/** What the command handler needs: the agent's lifecycle methods and the config. */
export type CommandDependencies = {
  readonly agent: Pick<RunningAgent, "reset" | "abort" | "inspect">;
  readonly config: WorkerConfig;
};

/** One Discord message, reduced to the channel the command acts on. */
type CommandMessage = { readonly channelId: string };

/** Where a command acts: the conversation key and whether a run is in flight. */
type CommandTarget = { readonly key: string; readonly busy: boolean };

/** One command's work: the argument in, the reply text out. */
type Command = (argument: string, target: CommandTarget) => Promise<string>;

/** The table of commands an owner can send, answered before the agent runs. */
function commandTable(
  agent: CommandDependencies["agent"],
  config: WorkerConfig,
): Record<string, Command> {
  const inboxNames = (): string => {
    let names: string[];
    try {
      names = readdirSync(join(config.workspace, config.inbox?.folder ?? ".agent-worker/inbox"));
    } catch {
      return "No scheduled jobs.";
    }
    return names.length === 0 ? "No scheduled jobs." : names.join(", ");
  };
  const skillNames = (): string => {
    const skills = listWorkspaceSkills(join(config.workspace, "skills"));
    return skills.length === 0
      ? "No skills installed."
      : skills.map((skill) => skill.name).join(", ");
  };
  const model = (): string => `${config.model.provider}/${config.model.modelId}`;

  return {
    context: async (_argument, target) => {
      const size = await agent.inspect(target.key);
      return `${size.messages} model messages over ${size.entries} transcript entries.`;
    },
    jobs: (_argument) => Promise.resolve(inboxNames()),
    model: () => Promise.resolve(model()),
    new: async (argument, target) => {
      await agent.reset(target.key, argument === "" ? undefined : argument);
      return target.busy
        ? "New session queued; it starts when the current turn finishes."
        : argument === ""
          ? "New session; the old history is out of context."
          : "New session; your message is its first.";
    },
    skills: (_argument) => Promise.resolve(skillNames()),
    status: async (_argument, target) => {
      const size = await agent.inspect(target.key);
      return [
        `model: ${model()}`,
        target.busy ? "state: working" : "state: idle",
        `context: ${size.messages} messages (${size.entries} entries)`,
      ].join("\n");
    },
    stop: async (_argument, target) => {
      await agent.abort(target.key);
      return "Stopped; the answer so far stays in the transcript.";
    },
  };
}

/**
 * The slash command handler: answers an owner's `/command` before the agent runs. An unknown word
 * returns undefined, so the message flows on to the agent as ordinary text.
 */
export function createCommandHandler({
  agent,
  config,
}: CommandDependencies): (
  message: CommandMessage,
  text: string,
  busy: boolean,
) => Promise<string | undefined> {
  const commands = commandTable(agent, config);
  return async (message, text, busy) => {
    const command = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (command?.[1] === undefined) return undefined;
    const run = commands[command[1]];
    if (run === undefined) return undefined;
    const argument = (command[2] ?? "").trim();
    return run(argument, { busy, key: `discord:${message.channelId}` });
  };
}
