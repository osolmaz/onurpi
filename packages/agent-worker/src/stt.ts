import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Audio attachments the tool transcribes: Discord voice notes and plain audio files. */
export function isAudioAttachment(name: string, contentType: string | null): boolean {
  if (contentType?.startsWith("audio/") === true) return true;
  return /\.(ogg|oga|opus|m4a|mp3|wav|flac|webm|aac)$/i.test(name);
}

/** One external command. Injectable for tests. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<void>;

/** The speech-to-text model runner: PCM samples in, its transcript out. Injectable for tests. */
export type Transcriber = (
  samples: Float32Array,
  model: string,
  cacheDir: string,
) => Promise<string>;

/** A command failure as a readable error: a missing binary gets its own line. */
export function commandError(command: string, error: NodeJS.ErrnoException, stderr: string): Error {
  if (error.code === "ENOENT") return new Error(`${command} is not installed`, { cause: error });
  return new Error(`${command} failed: ${stderr.slice(0, 400)}`, { cause: error });
}

const runCommand: RunCommand = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error !== null) {
          reject(commandError(command, error as NodeJS.ErrnoException, stderr));
          return;
        }
        resolve();
      },
    );
  });

/** The whisper pipeline for one model, loaded once per process and kept for the next run. */
const pipelines = new Map<string, Promise<(audio: Float32Array) => Promise<{ text?: string }>>>();

async function asrOf(
  model: string,
  cacheDir: string,
): Promise<(audio: Float32Array) => Promise<{ text?: string }>> {
  const cached = pipelines.get(model);
  if (cached !== undefined) return cached;
  const loading = (async () => {
    const imports = (await import("@huggingface/transformers")) as {
      env: { cacheDir: string; allowLocalModels: boolean };
      pipeline: (
        task: "automatic-speech-recognition",
        model: string,
        options?: { dtype?: string },
      ) => Promise<(audio: Float32Array) => Promise<{ text?: string }>>;
    };
    imports.env.cacheDir = cacheDir;
    imports.env.allowLocalModels = true;
    return imports.pipeline("automatic-speech-recognition", model, { dtype: "q8" });
  })();
  pipelines.set(model, loading);
  return loading;
}

/**
 * Transcribes one audio file: ffmpeg decodes it to 16 kHz mono float PCM, whisper reads that. The
 * transcript is trimmed text, empty for silence.
 */
export async function transcribeAudio(
  path: string,
  model: string,
  cacheDir: string,
  run: RunCommand = runCommand,
  transcriber: Transcriber = (samples, id, dir) =>
    asrOf(id, dir).then((asr) => asr(samples).then((out) => (out.text ?? "").trim())),
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stt-"));
  try {
    const pcm = join(dir, "audio.pcm");
    await run("ffmpeg", ["-y", "-i", path, "-ar", "16000", "-ac", "1", "-f", "f32le", pcm]);
    const bytes = await readFile(pcm);
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return (await transcriber(samples, model, cacheDir)).trim();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
