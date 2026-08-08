import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";

export const MODEL_ID = "gpt-test";
export const MODEL_KEY = `openai-codex:openai-codex-responses:${MODEL_ID}`;
export const TEST_SESSION_ID = "session-123";
export const FAKE_ACCOUNT_ID = "account-123";

/**
 * Structurally valid fake JWT for tests. The payload only carries a fake ChatGPT account ID; no
 * real credential material ever appears in this repository.
 */
export function makeToken(accountId: string = FAKE_ACCOUNT_ID): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

export function userEntry(id: string, text: string): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
  };
}

export function compactionSse(encryptedContent = "opaque-state"): Response {
  const events = [
    {
      type: "response.output_item.done",
      item: { type: "compaction", id: "cmp_1", encrypted_content: encryptedContent },
    },
    {
      type: "response.completed",
      response: { usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
    },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
