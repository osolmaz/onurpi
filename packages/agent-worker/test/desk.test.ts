import { describe, expect, it } from "vitest";
import type { ApprovalRequest, ApprovalState, ApprovalStore } from "../src/approvals.ts";
import { ApprovalDesk, type DeskAgent } from "../src/desk.ts";

const CHANNEL = "400000000000000004";
const FALLBACK = "500000000000000005";
const message = {
  authorId: "200000000000000002",
  authorIsBot: false,
  channelId: CHANNEL,
  content: "",
  guildId: "700000000000000007",
  id: "600000000000000006",
  isDirect: false,
  mentionsBot: false,
  parentChannelId: null,
};

function memoryStore(): ApprovalStore {
  const records = new Map<string, ApprovalRequest & { state: ApprovalState }>();
  return {
    add: (request) => {
      const id = String(records.size + 1);
      records.set(id, { ...request, state: "pending" });
      return Promise.resolve(id);
    },
    decide: (id, state) => {
      const record = records.get(id);
      if (record?.state !== "pending" && !(state === "used" && record?.state === "approved")) {
        return Promise.resolve(false);
      }
      record.state = state;
      return Promise.resolve(true);
    },
    get: (id) => Promise.resolve(records.get(id)),
  };
}

function setup(
  keys: Record<number, string> = { 1: `discord:${CHANNEL}`, 2: "job:digest" },
  fallback?: string,
) {
  const sent: { channelId: string; text: string }[] = [];
  const events: string[] = [];
  const store = memoryStore();
  const agent: DeskAgent = {
    approvals: store,
    chatKeyOf: (id: number) => Promise.resolve(keys[id]),
  };
  const desk = new ApprovalDesk((event) => events.push(event), fallback);
  const transport = {
    send: (channelId: string, text: string) => {
      sent.push({ channelId, text });
      return Promise.resolve("sent");
    },
  };
  return { agent, desk, events, sent, store, transport };
}

const held = {
  command: "git push origin main",
  conversationId: 1,
  fingerprint: "f1",
  tool: "bash",
};

describe("ApprovalDesk", () => {
  it("posts a card in the conversation's channel, also for a call held before Discord connected", async () => {
    const { agent, desk, events, sent, transport } = setup();
    desk.requested(held);
    desk.attach(agent, transport);
    await desk.idle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.channelId).toBe(CHANNEL);
    expect(sent[0]?.text).toContain("request 1");
    expect(sent[0]?.text).toContain("git push origin main");
    expect(sent[0]?.text).toContain("`approve 1`");
    expect(events).toEqual(["approval_requested"]);
  });

  it("sends cards for other conversations to the fallback channel, or logs them", async () => {
    const routed = setup(undefined, FALLBACK);
    routed.desk.attach(routed.agent, routed.transport);
    routed.desk.requested({ ...held, conversationId: 2 });
    await routed.desk.idle();
    expect(routed.sent[0]?.channelId).toBe(FALLBACK);

    const lost = setup();
    lost.desk.attach(lost.agent, lost.transport);
    lost.desk.requested({ ...held, conversationId: 2 });
    await lost.desk.idle();
    expect(lost.sent).toEqual([]);
    expect(lost.events).toEqual(["approval_unrouted"]);
  });

  it("turns an approval into a message for the conversation that holds the call", async () => {
    const { agent, desk, store, transport } = setup();
    desk.attach(agent, transport);
    desk.requested(held);

    expect(await desk.intercept(message, "approve 1")).toEqual({
      conversationKey: `discord:${CHANNEL}`,
      text: "The owner approved request 1: `git push origin main`. Run exactly that call again now.",
    });
    expect((await store.get("1"))?.state).toBe("approved");
    expect(await desk.intercept(message, "reject #1")).toEqual({
      reply: "Request 1 is already approved.",
    });
    desk.used("1");
    await desk.idle();
    expect((await store.get("1"))?.state).toBe("used");
  });

  it("turns a rejection into a message, and answers an unknown number directly", async () => {
    const { agent, desk, transport } = setup({ 1: `discord:${CHANNEL}` });
    desk.attach(agent, transport);
    desk.requested(held);
    desk.requested({ ...held, conversationId: 3, fingerprint: "f2" });

    expect(await desk.intercept(message, "Reject 1")).toEqual({
      conversationKey: `discord:${CHANNEL}`,
      text: "The owner rejected request 1: `git push origin main`. Do not run it, and do not try another way.",
    });
    expect(await desk.intercept(message, "approve 7")).toEqual({
      reply: "There is no approval request 7.",
    });
    expect(await desk.intercept(message, "approve 2")).toEqual({
      text: "The owner approved request 2: `git push origin main`. Run exactly that call again now.",
    });
  });

  it("leaves other messages alone, and logs a card it could not post", async () => {
    const { agent, desk, events } = setup();
    expect(await desk.intercept(message, "approve 1")).toBeUndefined();
    desk.attach(agent, {
      send: () => Promise.reject(new Error("Discord is down")),
    });
    expect(await desk.intercept(message, "please approve this")).toBeUndefined();
    desk.requested({ ...held, command: "x".repeat(2000) });
    await desk.idle();
    expect(events).toEqual(["approval_failed"]);
  });
});
