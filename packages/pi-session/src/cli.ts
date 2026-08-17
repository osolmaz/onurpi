#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args.js";
import { listSessions, loadSession, resolveSessionPath } from "./load.js";
import { boundedExcerpt } from "./redact.js";
import { renderEntryJson, renderListJson, renderRecoveryJson } from "./render-json.js";
import { renderEntryText, renderListText, renderRecoveryText } from "./render-text.js";
import { selectEntry, selectRecovery } from "./select.js";
import { MESSAGE_EXCERPT_BYTES, OUTPUT_SCHEMA, type SessionListDocument } from "./types.js";

export async function execute(args: readonly string[], cwd = process.cwd()): Promise<string> {
  const command = parseArgs(args);
  if (command.kind === "help") return help();
  if (command.kind === "list") return await executeList(command, cwd);
  if (command.kind === "entry") return await executeEntry(command, cwd);
  return await executeShow(command, cwd);
}

async function executeList(
  command: Extract<ReturnType<typeof parseArgs>, { kind: "list" }>,
  cwd: string,
): Promise<string> {
  const discovered = await listSessions(cwd, command.allProjects);
  const sessions = discovered.slice(0, command.limit);
  const document: SessionListDocument = {
    schema: OUTPUT_SCHEMA,
    scope: command.allProjects ? "all-projects" : "cwd",
    cwd,
    limit: command.limit,
    totalSessions: discovered.length,
    omittedSessions: discovered.length - sessions.length,
    sessions: sessions.map((session) => ({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name:
        session.name === undefined
          ? null
          : boundedExcerpt(session.name, MESSAGE_EXCERPT_BYTES).text,
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: boundedExcerpt(session.firstMessage, MESSAGE_EXCERPT_BYTES),
    })),
  };
  return command.format === "json" ? renderListJson(document) : renderListText(document);
}

async function executeEntry(
  command: Extract<ReturnType<typeof parseArgs>, { kind: "entry" }>,
  cwd: string,
): Promise<string> {
  const path = await resolveSessionPath(command.session, cwd, command.allProjects);
  const document = selectEntry(await loadSession(path), command.entryId);
  return command.format === "json" ? renderEntryJson(document) : renderEntryText(document);
}

async function executeShow(
  command: Extract<ReturnType<typeof parseArgs>, { kind: "show" }>,
  cwd: string,
): Promise<string> {
  const path = await resolveSessionPath(command.session, cwd, command.options.allProjects);
  const document = selectRecovery(await loadSession(path), command.options);
  return command.options.format === "json"
    ? renderRecoveryJson(document)
    : renderRecoveryText(document);
}

export async function runCli(args: readonly string[]): Promise<void> {
  try {
    process.stdout.write(await execute(args));
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pi-session: ${message}\n`);
    process.exitCode = 1;
  }
}

export function help(): string {
  return `${[
    "pi-session - bounded, read-only evidence from Pi sessions",
    "",
    "usage:",
    "  pi-session <session> [--last <count>] [--assistant <final|text|none>]",
    "                       [--include <workflow,plan,errors,files>]",
    "                       [--since <timestamp|entry-id>] [--format <text|json>]",
    "                       [--all-projects]",
    "  pi-session list [--all-projects] [--limit <count>] [--format <text|json>]",
    "  pi-session entry <session> <entry-id> [--all-projects] [--format <text|json>]",
    "",
    "session:",
    "  An absolute session JSONL path, full UUID, or unique UUID prefix.",
    "  UUID lookup uses the current working directory unless --all-projects is set.",
    "",
    "defaults:",
    "  --last 20",
    "  --assistant final",
    "  --include workflow,plan,errors,files",
    "  --format text",
    "",
    "limits:",
    "  Normal excerpts: 2 KiB. Workflow and plan excerpts: 8 KiB.",
    "  Complete text and JSON output: 40 KiB. Images and raw tool bodies are omitted.",
    "  Legacy sessions are not opened because Pi would migrate and rewrite them.",
    "",
  ].join("\n")}\n`;
}

async function isMainModule(): Promise<boolean> {
  const script = process.argv[1];
  if (script === undefined) return false;
  const [modulePath, scriptPath] = await Promise.all([
    realpath(fileURLToPath(import.meta.url)),
    realpath(script).catch(() => script),
  ]);
  return modulePath === scriptPath;
}

if (await isMainModule()) await runCli(process.argv.slice(2));
