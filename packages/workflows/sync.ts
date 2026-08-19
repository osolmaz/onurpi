import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RESULT_SCHEMA = "pi-workflows.herdr-sync.v1" as const;
const STATUSES = ["linked", "relinked", "enabled", "unchanged", "unavailable"] as const;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

type SyncStatus = (typeof STATUSES)[number];

export type WorkflowsSyncResult = {
  schema: typeof RESULT_SCHEMA;
  status: SyncStatus;
  changed: boolean;
  pluginId: string;
  expectedVersion: string;
  effectiveVersion: string | null;
  enabled: boolean | null;
  runningPiProcessesNeedReload: true;
  message: string;
};

type Run = (command: string, args: readonly string[]) => SpawnSyncReturns<string>;

export function syncWorkflows(run: Run = runCommand): WorkflowsSyncResult {
  const response = run("pi-workflows", ["herdr", "sync", "--json"]);
  if (response.error !== undefined) {
    throw new Error(`Could not run Pi Workflows synchronization: ${response.error.message}`);
  }
  if (response.status !== 0) {
    throw new Error(
      `Pi Workflows synchronization failed: ${bounded(response.stderr || response.stdout)}`,
    );
  }
  return parseResult(response.stdout);
}

function parseResult(stdout: string): WorkflowsSyncResult {
  const value = parseJson(stdout);
  if (!isRecord(value) || value["schema"] !== RESULT_SCHEMA) {
    throw new Error("Pi Workflows returned an unsupported synchronization result.");
  }
  const parsed = {
    schema: RESULT_SCHEMA,
    status: requiredStatus(value["status"]),
    changed: requiredBoolean(value["changed"]),
    pluginId: requiredString(value["pluginId"]),
    expectedVersion: requiredString(value["expectedVersion"]),
    effectiveVersion: nullableString(value["effectiveVersion"]),
    enabled: nullableBoolean(value["enabled"]),
    runningPiProcessesNeedReload: requiredReload(value["runningPiProcessesNeedReload"]),
    message: requiredString(value["message"]),
  } satisfies WorkflowsSyncResult;
  assertConsistent(parsed);
  return parsed;
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error("Pi Workflows returned invalid synchronization JSON.", { cause: error });
  }
}

function requiredStatus(value: unknown): SyncStatus {
  if (typeof value !== "string" || !isStatus(value)) {
    throw new Error("Pi Workflows returned an invalid synchronization status.");
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") incompleteResult();
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") incompleteResult();
  return value;
}

function nullableString(value: unknown): string | null {
  if (!isNullableString(value)) incompleteResult();
  return value;
}

function nullableBoolean(value: unknown): boolean | null {
  if (!isNullableBoolean(value)) incompleteResult();
  return value;
}

function requiredReload(value: unknown): true {
  if (value !== true) incompleteResult();
  return true;
}

function incompleteResult(): never {
  throw new Error("Pi Workflows returned an incomplete synchronization result.");
}

function assertConsistent(result: WorkflowsSyncResult): void {
  if (result.status === "unavailable") {
    if (result.changed || result.effectiveVersion !== null || result.enabled !== null) {
      throw new Error("Pi Workflows returned an inconsistent synchronization result.");
    }
    return;
  }
  if (result.effectiveVersion === null || result.enabled !== true) {
    throw new Error("Pi Workflows returned an inconsistent synchronization result.");
  }
}

function runCommand(command: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    shell: false,
  });
}

function isStatus(value: string): value is SyncStatus {
  return (STATUSES as readonly string[]).includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function bounded(value: string): string {
  const compact = value
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/ +/gu, " ")
    .trim();
  return compact.length <= 300 ? compact : `${compact.slice(0, 299)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const result = syncWorkflows();
    process.stdout.write(`${result.message}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
