import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { openAgent, answerOf, type RunningAgent } from "../src/agent.ts";
import { parseWorkerConfig, type WorkerConfig } from "../src/config.ts";
import { echoProvider, workerModels } from "../src/models.ts";
import type { Conversation, EntryId } from "@earendil-works/pi-durable";

const folders: string[] = [];
const agents: RunningAgent[] = [];

afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.close();
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

function workspace(extra: Record<string, unknown> = {}): WorkerConfig {
  const folder = mkdtempSync(join(tmpdir(), "agent-worker-"));
  folders.push(folder);
  mkdirSync(join(folder, "pi-agent"));
  mkdirSync(join(folder, "workspace"));
  return parseWorkerConfig(
    {
      agentDir: "pi-agent",
      discord: { ownerIds: ["200000000000000002"] },
      model: { provider: "echo" },
      workspace: "workspace",
      ...extra,
    },
    folder,
  );
}

function echoModels() {
  const echo = echoProvider();
  const models = createModels();
  models.setProvider(echo.provider);
  return { echo, models };
}

async function open(config: WorkerConfig, models = echoModels().models): Promise<RunningAgent> {
  const agent = await openAgent(config, models);
  agents.push(agent);
  return agent;
}

const request = {
  conversationKey: "discord:400000000000000004",
  requestId: "discord:1",
  text: "hello there",
};

describe("openAgent", () => {
  it("answers through the configured model", async () => {
    const agent = await open(workspace());
    expect(await agent.ask(request)).toEqual({ kind: "answer", text: "Echo: hello there" });
    expect(await agent.ask({ ...request, requestId: "discord:2", text: "and again" })).toEqual({
      kind: "answer",
      text: "Echo: and again",
    });
  });

  it("caps the model window at the compaction ceiling, so the harness compacts before it", () => {
    const models = workerModels({ modelId: "echo", provider: "echo" }, {}, 2000);
    const model = models.getModel("echo", "echo");
    expect(model?.contextWindow).toBe(2000);
    expect(model?.maxTokens).toBeLessThanOrEqual(2000);
    expect(models.getModel("echo", "echo")?.id).toBe("echo");
  });

  it("leaves a model whose window already fits the ceiling alone", () => {
    const model = workerModels({ modelId: "echo", provider: "echo" }, {}, 1_000_000).getModel(
      "echo",
      "echo",
    );
    expect(model?.contextWindow).toBe(128000);
  });

  it("summarizes the old transcript on compact(), and says when it cannot", async () => {
    const config = workspace({ compaction: { keepRecentTokens: 40 } });
    const agent = await open(config);
    for (let turn = 0; turn < 4; turn += 1) {
      await agent.ask({
        ...request,
        requestId: `discord:${String(turn)}`,
        text: `turn ${String(turn)} ${"word ".repeat(60)}`,
      });
    }
    const before = await agent.inspect(request.conversationKey);
    const outcome = await agent.compact(request.conversationKey, "keep the turn numbers");
    expect(outcome).toMatchObject({ before: before.messages, compacted: true });
    expect(outcome.after).toBeLessThan(before.messages);

    const empty = await open(workspace({ compaction: { keepRecentTokens: 40 } }));
    expect(await empty.compact("discord:400000000000000004")).toMatchObject({
      compacted: false,
    });
  });

  it("answers a repeated request id from storage, without a second model call", async () => {
    const { echo, models } = echoModels();
    const agent = await open(workspace(), models);
    await agent.ask(request);
    const calls = echo.state.callCount;

    expect(await agent.ask(request)).toEqual({ kind: "answer", text: "Echo: hello there" });
    expect(echo.state.callCount).toBe(calls);
  });

  it("keeps one conversation per chat key, also after a restart", async () => {
    const config = workspace();
    const first = await open(config);
    const id = await first.conversationFor("discord:a");
    expect(await first.conversationFor("discord:a")).toBe(id);
    expect(await first.conversationFor("discord:b")).not.toBe(id);
    await agents.pop()?.close();

    const second = await open(config);
    expect(await second.conversationFor("discord:a")).toBe(id);
  });

  it("gives the model the global and the workspace AGENTS.md, global first, as Pi does", async () => {
    const config = workspace();
    writeFileSync(join(config.agentDir, "AGENTS.md"), "Global: be brief.\n");
    writeFileSync(join(config.workspace, "AGENTS.md"), "Always answer in French.\n");
    const seen: string[] = [];
    const faux = fauxProvider({ models: [{ id: "echo", name: "Echo" }], provider: "echo" });
    faux.setResponses([
      (context) => {
        seen.push(JSON.stringify(context));
        return fauxAssistantMessage("Bonjour");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = await open(config, models);

    expect(await agent.ask(request)).toEqual({ kind: "answer", text: "Bonjour" });
    const prompt = seen.join("");
    expect(prompt).toContain(
      `<project_instructions path=\\"${join(config.agentDir, "AGENTS.md")}\\">`,
    );
    expect(prompt.indexOf("Global: be brief.")).toBeGreaterThan(-1);
    expect(prompt.indexOf("Global: be brief.")).toBeLessThan(
      prompt.indexOf("Always answer in French."),
    );
  });

  it("reports a failed model call", async () => {
    const faux = fauxProvider({ models: [{ id: "echo", name: "Echo" }], provider: "echo" });
    faux.setResponses([
      fauxAssistantMessage("", { errorMessage: "the model is down", stopReason: "error" }),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = await open(workspace(), models);

    expect(await agent.ask(request)).toMatchObject({ kind: "failed" });
  });

  it("keeps the Discord ledger across a restart, with positions that only move forward", async () => {
    const config = workspace();
    const first = await open(config);
    const waiting = {
      authorId: "200000000000000002",
      authorIsBot: false,
      channelId: "400000000000000004",
      content: "hi",
      guildId: "700000000000000007",
      id: "600000000000000006",
      isDirect: false,
      mentionsBot: true,
      parentChannelId: null,
    };
    await first.ledger.accept(waiting);
    await first.ledger.accept({ ...waiting, id: "600000000000000007" });
    await first.ledger.answered("600000000000000007");
    await first.ledger.answered("600000000000000099");
    await first.ledger.seen("400000000000000004", "600000000000000009");
    await first.ledger.seen("400000000000000004", "600000000000000008");
    await agents.pop()?.close();

    const second = await open(config);
    expect(await second.ledger.pending()).toEqual([waiting]);
    expect(await second.ledger.positions()).toEqual({ "400000000000000004": "600000000000000009" });
  });

  it("keeps the record of posted job answers across a restart", async () => {
    const config = workspace();
    const first = await open(config);
    expect(await first.jobs.posted("job:digest@2026-10-18T01:00:00.000Z")).toBe(false);
    await first.jobs.markPosted("job:digest@2026-10-18T01:00:00.000Z", "message-1");
    await agents.pop()?.close();

    const second = await open(config);
    expect(await second.jobs.posted("job:digest@2026-10-18T01:00:00.000Z")).toBe(true);
  });
});

describe("answerOf", () => {
  it("re-reads the answer entry while its text is still streaming in", async () => {
    const entry = (text: string) => ({
      kind: "pi.assistant",
      id: 779,
      model: [{ role: "assistant", content: [{ type: "text", text }] }],
    });
    const reads: string[] = ["", ""];
    const conversation = {
      commit: () => Promise.resolve(entry(reads.shift() ?? "late text")),
    } as unknown as Conversation;

    expect(await answerOf(conversation, 779 as EntryId)).toBe("late text");
  });
});
