import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboundAttachment, SavedAttachment } from "@onurpi/discord-adapter";
import type { WorkerConfig } from "./config.ts";
import { isAudioAttachment, transcribeAudio } from "./stt.ts";
/** How long a saved attachment stays in the workspace before the sweep removes it. */
export const ATTACHMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_STT_MODEL = "ggml-small.bin";

/** The image folder that holds the baked-in whisper.cpp models. */
export const STT_MODELS_DIR = "/app/models";

/** Downloads one Discord attachment into the workspace, where the agent's tools can read it. */
export async function saveAttachment(
  workspace: string,
  attachment: InboundAttachment,
): Promise<string> {
  const safeName = attachment.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  const dir = join(workspace, ".agent-worker", "attachments", attachment.id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, safeName === "" || safeName === "." ? "file" : safeName);
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

/**
 * The extra note for one saved attachment: a voice note or audio file comes back with its
 * transcript, so the model hears the message before it answers. The general transcription service
 * gets the file when one is configured; otherwise the baked-in whisper.cpp transcribes. Everything
 * else is silent.
 */
/** The configured STT: the general service's URL, if any, and the local whisper model's path. */
function sttSettings(config: WorkerConfig): { localModel: string; serviceUrl?: string } {
  if (config.stt === false) return { localModel: join(STT_MODELS_DIR, DEFAULT_STT_MODEL) };
  const stt = typeof config.stt === "object" ? config.stt : {};
  return {
    localModel: join(STT_MODELS_DIR, stt.model ?? DEFAULT_STT_MODEL),
    ...(stt.url === undefined ? {} : { serviceUrl: stt.url }),
  };
}

export async function annotateAttachment(
  config: WorkerConfig,
  saved: SavedAttachment,
  transcribe: (path: string, modelPath: string) => Promise<string> = transcribeAudio,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  if (config.stt === false) return undefined;
  if (!isAudioAttachment(saved.name, saved.contentType)) return undefined;
  const { localModel, serviceUrl } = sttSettings(config);
  try {
    const text = await transcribeViaService(saved.path, serviceUrl, fetchImpl).catch(
      (error: unknown) => {
        if (serviceUrl !== undefined) throw error;
        return transcribe(saved.path, localModel);
      },
    );
    return text === ""
      ? "; transcribed as: (silence or unintelligible)"
      : `; transcribed as: \u201c${text}\u201d`;
  } catch (error) {
    return `; transcription failed (${(error as Error).message})`;
  }
}

/** The transcript from the general transcription service: POST the file, read the text back. */
async function transcribeViaService(
  path: string,
  url: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (url === undefined) return Promise.reject(new Error("no transcription service is configured"));
  const audio = await import("node:fs/promises").then((fs) => fs.readFile(path));
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audio,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`the transcription service answered ${response.status}`);
  }
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { text?: string; transcript?: string };
    return (parsed.text ?? parsed.transcript ?? body).trim();
  } catch {
    return body.trim();
  }
}

/**
 * Deletes attachment folders older than the retention window and returns how many folders it
 * removed. A folder that cannot be read or removed is skipped, so one bad folder never stops the
 * sweep.
 */
export async function pruneAttachments(
  workspace: string,
  now: number,
  retentionMs = ATTACHMENT_RETENTION_MS,
): Promise<number> {
  const root = join(workspace, ".agent-worker", "attachments");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const info = await stat(dir).catch(() => undefined);
    if (info === undefined || now - info.mtimeMs <= retentionMs) continue;
    const gone = await rm(dir, { force: true, recursive: true })
      .then(() => true)
      .catch(() => false);
    if (gone) removed += 1;
  }
  return removed;
}
