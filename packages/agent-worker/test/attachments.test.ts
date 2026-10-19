import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputFor } from "../src/agent.ts";

describe("inputFor", () => {
  it("passes plain text through untouched", async () => {
    const input = await inputFor({ conversationKey: "c", requestId: "r", text: "hello" });
    expect(input).toBe("hello");
  });

  it("turns image attachments into image blocks the model sees", async () => {
    const dir = await mkdtemp(join(tmpdir(), "attachments-"));
    const path = join(dir, "photo.png");
    await writeFile(path, "PNGDATA");
    const input = await inputFor({
      conversationKey: "c",
      requestId: "r",
      text: "what is this?",
      attachments: [{ contentType: "image/png", name: "photo.png", path }],
    });
    expect(input).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", data: "UE5HREFUQQ==", mimeType: "image/png" },
    ]);
  });

  it("leaves non-image files on disk, named by the prompt", async () => {
    const input = await inputFor({
      conversationKey: "c",
      requestId: "r",
      text: "summarize notes.txt saved at /workspace/notes.txt",
      attachments: [{ contentType: "text/plain", name: "notes.txt", path: "/workspace/notes.txt" }],
    });
    expect(input).toBe("summarize notes.txt saved at /workspace/notes.txt");
  });
});
