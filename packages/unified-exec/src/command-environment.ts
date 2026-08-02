export const COMMAND_ENVIRONMENT_EVENT = "unified-exec:before-spawn";

export type CommandEnvironmentModel = Readonly<{
  id: string;
  name: string;
  provider: string;
}>;

export type CommandEnvironmentEvent = {
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly model: CommandEnvironmentModel | undefined;
  environment: NodeJS.ProcessEnv;
};

export type PrepareCommandEnvironment = (event: CommandEnvironmentEvent) => void;

function isProcessEnvironment(value: unknown): value is NodeJS.ProcessEnv {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((item) => item === undefined || typeof item === "string");
}

function isCommandEnvironmentModel(value: unknown): value is CommandEnvironmentModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return (
    typeof model["id"] === "string" &&
    typeof model["name"] === "string" &&
    typeof model["provider"] === "string"
  );
}

export function isCommandEnvironmentEvent(value: unknown): value is CommandEnvironmentEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event["command"] === "string" &&
    typeof event["cwd"] === "string" &&
    typeof event["shell"] === "string" &&
    (event["model"] === undefined || isCommandEnvironmentModel(event["model"])) &&
    isProcessEnvironment(event["environment"])
  );
}

export function commandEnvironmentEvent(
  command: string,
  cwd: string,
  shell: string,
  model: CommandEnvironmentModel | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): CommandEnvironmentEvent {
  return {
    command,
    cwd,
    shell,
    model,
    environment: { ...environment },
  };
}
