import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Audio attachments the tool transcribes: Discord voice notes and plain audio files. */
export function isAudioAttachment(name: string, contentType: string | null): boolean {
  if (contentType?.startsWith("audio/") === true) return true;
  return /\.(ogg|oga|opus|m4a|mp3|wav|flac|webm|aac)$/i.test(name);
}

/** One external command, resolving with its stdout. Injectable for tests. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<string>;

/** The speech-to-text model runner: an audio file in, its transcript out. Injectable for tests. */
export type Transcriber = (wavPath: string, modelPath: string) => Promise<string>;

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
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(commandError(command, error as NodeJS.ErrnoException, stderr));
          return;
        }
        resolve(stdout);
      },
    );
  });

/** The transcript from whisper-cli's stdout, run without timestamps or prints. */
export function whisperTranscript(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("system_info:"))
    .join(" ")
    .trim();
}

/** The default transcriber: whisper-cli reads the WAV with the baked-in model. */
export function whisperTranscriber(run: RunCommand = runCommand): Transcriber {
  return (wavPath, modelPath) =>
    run("whisper-cli", ["-m", modelPath, "-f", wavPath, "-nt", "-np", "-l", "auto"]).then(
      whisperTranscript,
    );
}

/**
 * Transcribes one audio file: ffmpeg decodes it to 16 kHz mono WAV, whisper-cli reads that. The
 * transcript is trimmed text, empty for silence.
 */
export async function transcribeAudio(
  path: string,
  modelPath: string,
  run: RunCommand = runCommand,
  transcriber: Transcriber = whisperTranscriber(run),
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stt-"));
  try {
    const wav = join(dir, "audio.wav");
    await run("ffmpeg", ["-y", "-i", path, "-ar", "16000", "-ac", "1", "-f", "wav", wav]);
    return (await transcriber(wav, modelPath)).trim();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
