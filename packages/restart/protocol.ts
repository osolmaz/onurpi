export const RESTART_PROTOCOL_SCHEMA = "onurpi-restart-v1";
export const RESTART_PROTOCOL_ENV = "ONURPI_RESTART_PROTOCOL";
export const RESTART_GENERATION_ENV = "ONURPI_RESTART_GENERATION";
export const EXPECTED_SESSION_FILE_ENV = "ONURPI_RESTART_EXPECTED_SESSION_FILE";
export const EXPECTED_SESSION_ID_ENV = "ONURPI_RESTART_EXPECTED_SESSION_ID";
export const EXPECTED_CWD_ENV = "ONURPI_RESTART_EXPECTED_CWD";

const MAX_ID_LENGTH = 128;
const MAX_PATH_LENGTH = 4096;
const MAX_REASON_LENGTH = 1000;

type RestartIdentity = {
  sessionFile: string;
  sessionId: string;
  cwd: string;
};

export type RestartRequest = RestartIdentity & {
  schema: typeof RESTART_PROTOCOL_SCHEMA;
  type: "restartRequest";
  requestId: string;
  generation: string;
};

export type RuntimeReady = RestartIdentity & {
  schema: typeof RESTART_PROTOCOL_SCHEMA;
  type: "runtimeReady";
  generation: string;
};

export type LauncherInboundMessage = RestartRequest | RuntimeReady;

export type RestartAccepted = {
  schema: typeof RESTART_PROTOCOL_SCHEMA;
  type: "restartAccepted";
  requestId: string;
  generation: string;
};

export type RestartRejected = {
  schema: typeof RESTART_PROTOCOL_SCHEMA;
  type: "restartRejected";
  requestId: string;
  generation: string;
  reason: string;
};

export type LauncherOutboundMessage = RestartAccepted | RestartRejected;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes("\0")
  );
}

function identity(value: Record<string, unknown>): RestartIdentity | undefined {
  const sessionFile = value["sessionFile"];
  const sessionId = value["sessionId"];
  const cwd = value["cwd"];
  if (!boundedString(sessionFile, MAX_PATH_LENGTH)) return undefined;
  if (!boundedString(sessionId, MAX_ID_LENGTH)) return undefined;
  if (!boundedString(cwd, MAX_PATH_LENGTH)) return undefined;
  return { sessionFile, sessionId, cwd };
}

function generationOf(value: Record<string, unknown>): string | undefined {
  const generation = value["generation"];
  return boundedString(generation, MAX_ID_LENGTH) ? generation : undefined;
}

function requestIdOf(value: Record<string, unknown>): string | undefined {
  const requestId = value["requestId"];
  return boundedString(requestId, MAX_ID_LENGTH) ? requestId : undefined;
}

function parseRestartRequest(value: Record<string, unknown>): RestartRequest | undefined {
  const keys = ["schema", "type", "requestId", "generation", "sessionFile", "sessionId", "cwd"];
  if (!hasExactKeys(value, keys)) return undefined;
  const requestId = requestIdOf(value);
  const generation = generationOf(value);
  const parsedIdentity = identity(value);
  if (!(requestId && generation && parsedIdentity)) return undefined;
  return {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "restartRequest",
    requestId,
    generation,
    ...parsedIdentity,
  };
}

function parseRuntimeReady(value: Record<string, unknown>): RuntimeReady | undefined {
  const keys = ["schema", "type", "generation", "sessionFile", "sessionId", "cwd"];
  if (!hasExactKeys(value, keys)) return undefined;
  const generation = generationOf(value);
  const parsedIdentity = identity(value);
  if (!(generation && parsedIdentity)) return undefined;
  return { schema: RESTART_PROTOCOL_SCHEMA, type: "runtimeReady", generation, ...parsedIdentity };
}

export function parseLauncherInboundMessage(value: unknown): LauncherInboundMessage | undefined {
  if (!isRecord(value) || value["schema"] !== RESTART_PROTOCOL_SCHEMA) return undefined;
  if (value["type"] === "restartRequest") return parseRestartRequest(value);
  if (value["type"] === "runtimeReady") return parseRuntimeReady(value);
  return undefined;
}

function parseAccepted(value: Record<string, unknown>): RestartAccepted | undefined {
  if (!hasExactKeys(value, ["schema", "type", "requestId", "generation"])) return undefined;
  const requestId = requestIdOf(value);
  const generation = generationOf(value);
  if (!(requestId && generation)) return undefined;
  return { schema: RESTART_PROTOCOL_SCHEMA, type: "restartAccepted", requestId, generation };
}

function parseRejected(value: Record<string, unknown>): RestartRejected | undefined {
  const keys = ["schema", "type", "requestId", "generation", "reason"];
  if (!hasExactKeys(value, keys)) return undefined;
  const requestId = requestIdOf(value);
  const generation = generationOf(value);
  const reason = value["reason"];
  if (!(requestId && generation && boundedString(reason, MAX_REASON_LENGTH))) return undefined;
  return {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "restartRejected",
    requestId,
    generation,
    reason,
  };
}

export function parseLauncherOutboundMessage(value: unknown): LauncherOutboundMessage | undefined {
  if (!isRecord(value) || value["schema"] !== RESTART_PROTOCOL_SCHEMA) return undefined;
  if (value["type"] === "restartAccepted") return parseAccepted(value);
  if (value["type"] === "restartRejected") return parseRejected(value);
  return undefined;
}

export function restartAccepted(request: RestartRequest): RestartAccepted {
  return {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "restartAccepted",
    requestId: request.requestId,
    generation: request.generation,
  };
}

export function restartRejected(request: RestartRequest, reason: string): RestartRejected {
  const boundedReason = reason.slice(0, MAX_REASON_LENGTH) || "Restart request rejected.";
  return {
    schema: RESTART_PROTOCOL_SCHEMA,
    type: "restartRejected",
    requestId: request.requestId,
    generation: request.generation,
    reason: boundedReason,
  };
}
