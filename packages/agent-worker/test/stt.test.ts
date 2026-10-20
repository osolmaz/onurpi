import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { commandError, isAudioAttachment, transcribeAudio } from "../src/stt.ts";

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

  it("decodes with ffmpeg to 16 kHz mono PCM before transcribing", async () => {
    const calls: { args: readonly string[]; command: string }[] = [];
    const text = await transcribeAudio(
      "/workspace/voice.ogg",
      "Xenova/whisper-small",
      "/cache",
      (command, args) => {
        calls.push({ args, command });
        return writeFile(String(args.at(-1)), Buffer.alloc(8));
      },
      (samples, model) => {
        expect(samples).toBeInstanceOf(Float32Array);
        expect(model).toBe("Xenova/whisper-small");
        return Promise.resolve("  hello from the voice note  \n");
      },
    );

    expect(calls).toEqual([
      {
        args: [
          "-y",
          "-i",
          "/workspace/voice.ogg",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "f32le",
          expect.stringMatching(/stt-.*\/audio\.pcm$/u),
        ],
        command: "ffmpeg",
      },
    ]);
    expect(text).toBe("hello from the voice note");
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
