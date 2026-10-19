import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboundAttachment } from "@onurpi/discord-adapter";

/** One attachment saved under the workspace, where the agent's tools can read it. */
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
