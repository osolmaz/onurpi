import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentReply, AgentRequest } from "@onurpi/discord-adapter";
import { afterEach, describe, expect, it } from "vitest";
import { deliver, deliveryName, Inbox, type JobLedger } from "../src/inbox.ts";

const CHANNEL = "400000000000000004";
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

function inboxFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "agent-worker-inbox-"));
  folders.push(folder);
  return folder;
}

function setup(
  reply: (request: AgentRequest) => AgentReply = (request) => ({
    kind: "answer",
    text: `Echo: ${request.text}`,
  }),
  suppress?: readonly string[],
) {
  const folder = inboxFolder();
  const requests: AgentRequest[] = [];
  const sent: { channelId: string; text: string }[] = [];
  const events: string[] = [];
  const posted = new Map<string, string>();
  const ledger: JobLedger = {
    markPosted: (requestId, messageId) => {
      posted.set(requestId, messageId);
      return Promise.resolve();
    },
    posted: (requestId) => Promise.resolve(posted.has(requestId)),
  };
  const transport = {
    send: (channelId: string, text: string) => {
      sent.push({ channelId, text });
      return Promise.resolve(`sent-${String(sent.length)}`);
    },
  };
  const inbox = new Inbox({
    agent: {
      ask: (request) => {
        requests.push(request);
        return Promise.resolve(reply(request));
      },
    },
    channelIds: [CHANNEL],
    folder,
    ledger,
    log: (event) => events.push(event),
    pollMs: 10,
    ...(suppress === undefined ? {} : { suppress }),
    transport,
  });
  return { events, folder, inbox, ledger, posted, requests, sent, transport };
}

const delivery = {
  channelId: CHANNEL,
  job: "daily-digest",
  prompt: "write the digest",
  scheduledFor: "2026-10-18T01:00:00Z",
};

describe("deliveryName", () => {
  it("names a delivery after its job and its scheduled time in UTC", () => {
    expect(deliveryName("daily-digest", "2026-10-18T09:00:00+08:00")).toBe(
      "daily-digest@2026-10-18T01:00:00.000Z.json",
    );
  });

  it("refuses unsafe job ids and invalid times", () => {
    expect(() => deliveryName("../x", "2026-10-18T01:00:00Z")).toThrow("A job id may hold only");
    expect(() => deliveryName("job", "tomorrow")).toThrow("Not a valid scheduled time");
  });
});

describe("deliver", () => {
  it("writes a delivery once, also after it was answered", async () => {
    const folder = inboxFolder();
    expect(await deliver(folder, delivery)).toBe(true);
    expect(await deliver(folder, { ...delivery, scheduledFor: "2026-10-18T09:00:00+08:00" })).toBe(
      false,
    );
    expect(readdirSync(folder).sort()).toEqual([
      "daily-digest@2026-10-18T01:00:00.000Z.json",
      "done",
    ]);
  });
});

describe("Inbox", () => {
  it("answers a delivery in its channel and moves it to done", async () => {
    const { folder, inbox, posted, requests, sent } = setup();
    await deliver(folder, delivery);
    await inbox.scan();

    expect(requests).toEqual([
      {
        conversationKey: "job:daily-digest",
        requestId: "job:daily-digest@2026-10-18T01:00:00.000Z",
        text: "write the digest",
      },
    ]);
    expect(sent).toEqual([{ channelId: CHANNEL, text: "Echo: write the digest" }]);
    expect([...posted.keys()]).toEqual(["job:daily-digest@2026-10-18T01:00:00.000Z"]);
    expect(readdirSync(folder)).toEqual(["done"]);
    expect(await deliver(folder, delivery)).toBe(false);
  });

  it("does not post again when the answer was already posted", async () => {
    const { folder, inbox, ledger, requests, sent } = setup();
    await ledger.markPosted("job:daily-digest@2026-10-18T01:00:00.000Z", "earlier");
    await deliver(folder, delivery);
    await inbox.scan();

    expect(requests).toEqual([]);
    expect(sent).toEqual([]);
    expect(readdirSync(join(folder, "done"))).toEqual([
      "daily-digest@2026-10-18T01:00:00.000Z.json",
    ]);
  });

  it("refuses a channel that the configuration does not list", async () => {
    const { events, folder, inbox, sent } = setup();
    await deliver(folder, { ...delivery, channelId: "999999999999999999" });
    await inbox.scan();

    expect(sent).toEqual([]);
    expect(events).toEqual(["job_refused"]);
  });

  it("posts a short note when the agent could not finish", async () => {
    const { folder, inbox, sent } = setup(() => ({ kind: "failed", reason: "model_error" }));
    await deliver(folder, delivery);
    await inbox.scan();

    expect(sent.map((item) => item.text)).toEqual([
      "Sorry, the job daily-digest could not finish: model_error",
    ]);
  });

  it("keeps a delivery that failed to post, and posts it on the next scan", async () => {
    const { events, folder, inbox, sent, transport } = setup();
    const send = transport.send;
    transport.send = () => Promise.reject(new Error("Discord is down"));
    await deliver(folder, delivery);
    await inbox.scan();
    expect(events).toEqual(["job_failed"]);
    expect(readdirSync(folder)).toContain("daily-digest@2026-10-18T01:00:00.000Z.json");

    transport.send = send;
    await inbox.scan();
    expect(sent).toHaveLength(1);
  });

  it("logs a file that is not a delivery and leaves it", async () => {
    const { events, folder, inbox } = setup();
    writeFileSync(join(folder, "broken.json"), "{");
    writeFileSync(join(folder, "empty.json"), "{}");
    await inbox.scan();

    expect(events).toEqual(["job_failed", "job_failed"]);
  });

  it("polls until it is stopped", async () => {
    const { folder, inbox, sent } = setup();
    inbox.start();
    await deliver(folder, delivery);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await inbox.stop();

    expect(sent).toHaveLength(1);
  });

  it("posts a suppressed answer nowhere, but still completes the delivery", async () => {
    const { events, folder, inbox, posted, sent } = setup(
      () => ({ kind: "answer", text: "NO_SIGNAL" }),
      ["NO_SIGNAL"],
    );
    await deliver(folder, delivery);
    await inbox.scan();

    expect(sent).toEqual([]);
    expect(events).toEqual(["job_suppressed"]);
    expect([...posted.keys()]).toEqual([]);
    expect(readdirSync(join(folder, "done"))).toContain(
      "daily-digest@2026-10-18T01:00:00.000Z.json",
    );
  });

  it("keeps a non-suppressed answer posting normally", async () => {
    const { folder, inbox, sent } = setup(undefined, ["NO_SIGNAL"]);
    await deliver(folder, { ...delivery, job: "watch" });
    await inbox.scan();
    expect(sent).toHaveLength(1);
  });
});
