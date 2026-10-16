import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { openAgent, type RunningAgent } from "../src/agent.ts";
import { parseWorkerConfig, type WorkerConfig } from "../src/config.ts";
import { echoProvider } from "../src/models.ts";

const folders: string[] = [];
const agents: RunningAgent[] = [];

afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.close();
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

function workspace(): WorkerConfig {
  const folder = mkdtempSync(join(tmpdir(), "agent-worker-"));
  folders.push(folder);
  return parseWorkerConfig(
    {
      discord: { ownerIds: ["200000000000000002"] },
      model: { provider: "echo" },
      workspace: folder,
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

  it("gives the workspace AGENTS.md to the model", async () => {
    const config = workspace();
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
    expect(seen.join("")).toContain("Always answer in French.");
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
});
