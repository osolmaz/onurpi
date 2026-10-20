import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { commandError, isAudioAttachment, transcribeAudio, whisperTranscript } from "../src/stt.ts";

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
});
