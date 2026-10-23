import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { annotateAttachment, DEFAULT_STT_MODEL } from "../src/attachments.ts";
import { commandError, isAudioAttachment, transcribeAudio, whisperTranscript } from "../src/stt.ts";
import type { WorkerConfig } from "../src/config.ts";

describe("stt", () => {
  it("hears audio by content type or extension", () => {
    expect(isAudioAttachment("voice.ogg", "audio/ogg; codecs=opus")).toBe(true);
    expect(isAudioAttachment("clip.ogg", null)).toBe(true);
    expect(isAudioAttachment("note.m4a", null)).toBe(true);
    expect(isAudioAttachment("song.mp3", "application/octet-stream")).toBe(true);
    expect(isAudioAttachment("photo.png", null)).toBe(false);
    expect(isAudioAttachment("report.pdf", "application/pdf")).toBe(false);
    expect(isAudioAttachment("movie.mp4", "video/mp4")).toBe(false);
  });

  it("decodes with ffmpeg to 16 kHz mono WAV, then runs whisper-cli on it", async () => {
    const calls: { args: readonly string[]; command: string }[] = [];
    const text = await transcribeAudio(
      "/workspace/voice.ogg",
      "/app/models/ggml-small.bin",
      (command, args) => {
        calls.push({ args, command });
        if (command === "ffmpeg") {
          const target = args.at(-1);
          if (target === undefined) throw new Error("no target");
          return writeFile(target, Buffer.alloc(8)).then(() => "");
        }
        return Promise.resolve(
          "system_info: n_cpus = 8\n\nAnd so, my fellow Americans, ask not…\n",
        );
      },
    );

    expect(calls[0]).toEqual({
      args: [
        "-y",
        "-i",
        "/workspace/voice.ogg",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        expect.stringMatching(/stt-.*\/audio\.wav$/u),
      ],
      command: "ffmpeg",
    });
    expect(calls[1]?.command).toBe("whisper-cli");
    expect(calls[1]?.args).toEqual([
      "-m",
      "/app/models/ggml-small.bin",
      "-f",
      expect.stringMatching(/stt-.*\/audio\.wav$/u),
      "-nt",
      "-np",
      "-l",
      "auto",
    ]);
    expect(text).toBe("And so, my fellow Americans, ask not…");
  });

  it("joins whisper-cli's segment lines into one transcript", () => {
    expect(whisperTranscript("first line\nsecond line\n\n  \nthird\n")).toBe(
      "first line second line third",
    );
  });

  it("reports a missing ffmpeg clearly", () => {
    const error = commandError(
      "ffmpeg",
      Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }),
      "",
    );

    expect(error.message).toBe("ffmpeg is not installed");
  });

  it("posts the audio to the general service when stt.url is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stt-test-"));
    const path = join(dir, "voice.ogg");
    await writeFile(path, Buffer.alloc(8));
    let received: { body?: unknown; type?: string | undefined } = {};
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
      received = {
        body: init?.body,
        type: init?.headers
          ? String((init.headers as Record<string, string>)["Content-Type"])
          : undefined,
      };
      return Promise.resolve(new Response('{"text": "from the service"}', { status: 200 }));
    }) as typeof fetch;
    const saved = { contentType: "audio/ogg", name: "voice.ogg", path };
    const note = await annotateAttachment(
      { stt: { url: "http://mac:9000/transcribe" } } as unknown as WorkerConfig,
      saved,
      () => Promise.resolve(""),
      fetchImpl,
    );

    expect(received.type).toBe("application/octet-stream");
    expect(received.body).toBeInstanceOf(Buffer);
    expect(note).toBe("; transcribed as: \u201cfrom the service\u201d");
  });

  it("falls back to whisper-cli when the service is not configured", async () => {
    const calls: string[] = [];
    const note = await annotateAttachment(
      {} as unknown as WorkerConfig,
      { contentType: "audio/ogg", name: "voice.ogg", path: "/workspace/voice.ogg" },
      (_path, modelPath) => {
        calls.push(modelPath);
        return Promise.resolve("local transcript");
      },
    );

    expect(note).toBe("; transcribed as: \u201clocal transcript\u201d");
    expect(calls).toEqual([`/app/models/${DEFAULT_STT_MODEL}`]);
  });

  it("reports a failed service instead of blocking the run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stt-test-"));
    const path = join(dir, "voice.ogg");
    await writeFile(path, Buffer.alloc(8));
    const saved = { contentType: "audio/ogg", name: "voice.ogg", path };
    const fetchImpl = (() =>
      Promise.resolve(new Response("down", { status: 503 }))) as typeof fetch;
    const note = await annotateAttachment(
      { stt: { url: "http://mac:9000/transcribe" } } as unknown as WorkerConfig,
      saved,
      () => Promise.resolve(""),
      fetchImpl,
    );

    expect(note).toContain("transcription failed");
    expect(note).toContain("503");
  });
});
