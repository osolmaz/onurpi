import { access, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputFor } from "../src/agent.ts";
import { pruneAttachments } from "../src/attachments.ts";

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

describe("pruneAttachments", () => {
  it("removes attachment folders older than the retention window and keeps fresh ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "prune-"));
    const folder = join(root, ".agent-worker", "attachments");
    const old = join(folder, "old");
    const fresh = join(folder, "fresh");
    await mkdir(old, { recursive: true });
    await mkdir(fresh, { recursive: true });
    await writeFile(join(old, "f.txt"), "x");
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(old, stale, stale);

    const removed = await pruneAttachments(root, Date.now());

    expect(removed).toBe(1);
    await expect(access(old)).rejects.toThrow();
    await expect(access(fresh)).resolves.toBeUndefined();
  });

  it("returns zero when the attachments folder does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "prune-empty-"));
    expect(await pruneAttachments(root, Date.now())).toBe(0);
  });
});
