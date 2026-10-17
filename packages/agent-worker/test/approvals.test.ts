import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { openAgent, type RunningAgent } from "../src/agent.ts";
import {
  DEFAULT_HELD_COMMANDS,
  fingerprint,
  heldCommand,
  type ApprovalRequest,
} from "../src/approvals.ts";
import { parseWorkerConfig } from "../src/config.ts";

const rules = DEFAULT_HELD_COMMANDS.map((pattern) => new RegExp(pattern, "u"));
const folders: string[] = [];
const agents: RunningAgent[] = [];

afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.close();
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

describe("heldCommand", () => {
  it.each([
    "git push origin main",
    "cd repo && git push --force",
    "gh pr merge 12 --rebase",
    "gh release create v1.0.0",
    "gh repo delete owner/repo --yes",
    "npm publish",
    "rm -rf build",
    "rm -fr /tmp/x",
  ])("holds %s", (command) => {
    expect(heldCommand({ arguments: { command }, name: "bash" }, rules)).toBe(command);
  });

  it.each(["git status", "git pushd", "gh pr view 12", "rm -f file.txt", "ls -rf"])(
    "lets %s run",
    (command) => {
      expect(heldCommand({ arguments: { command }, name: "bash" }, rules)).toBeUndefined();
    },
  );

  it("looks only at bash calls with a command", () => {
    expect(heldCommand({ arguments: { path: "git push" }, name: "write" }, rules)).toBeUndefined();
    expect(heldCommand({ arguments: { command: 3 }, name: "bash" }, rules)).toBeUndefined();
    expect(heldCommand({ arguments: null, name: "bash" }, rules)).toBeUndefined();
  });
});

describe("fingerprint", () => {
  it("is the same for the same call and differs for another call", () => {
    const one = fingerprint({ arguments: { command: "git push", timeout: 5 }, name: "bash" });
    expect(fingerprint({ arguments: { timeout: 5, command: "git push" }, name: "bash" })).toBe(one);
    expect(
      fingerprint({ arguments: { command: "git push --force", timeout: 5 }, name: "bash" }),
    ).not.toBe(one);
    expect(fingerprint({ arguments: [1, { b: null, a: true }], name: "x" })).toBe(
      fingerprint({ arguments: [1, { a: true, b: null }], name: "x" }),
    );
  });
});

describe("the approvals extension", () => {
  it("blocks a held call until the owner approves it, then lets the same call run once", async () => {
    const folder = mkdtempSync(join(tmpdir(), "agent-worker-approvals-"));
    folders.push(folder);
    const config = parseWorkerConfig(
      {
        agentDir: folder,
        discord: { ownerIds: ["200000000000000002"] },
        model: { provider: "echo" },
        workspace: folder,
      },
      folder,
    );
    const command = "git push --dry-run nowhere main";
    const seen: string[] = [];
    const faux = fauxProvider({ models: [{ id: "echo", name: "Echo" }], provider: "echo" });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" }),
      (context) => {
        seen.push(JSON.stringify(context.messages.at(-1)));
        return fauxAssistantMessage("I will wait for the owner.");
      },
      fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" }),
      (context) => {
        seen.push(JSON.stringify(context.messages.at(-1)));
        return fauxAssistantMessage("Done.");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const requested: ApprovalRequest[] = [];
    const used: string[] = [];
    const agent = await openAgent(config, models, {
      approvals: { requested: (request) => requested.push(request), used: (id) => used.push(id) },
    });
    agents.push(agent);

    const key = "discord:400000000000000004";
    expect(
      await agent.ask({ conversationKey: key, requestId: "discord:1", text: "push it" }),
    ).toEqual({
      kind: "answer",
      text: "I will wait for the owner.",
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]?.command).toBe(command);
    expect(seen[0]).toContain("waits for the owner's approval");
    expect(await agent.chatKeyOf(requested[0]?.conversationId ?? 0)).toBe(key);

    const request = requested[0];
    if (request === undefined) throw new Error("the held call made no request");
    const id = await agent.approvals.add(request);
    expect(await agent.approvals.decide(id, "used")).toBe(false);
    expect(await agent.approvals.decide(id, "approved")).toBe(true);
    expect(await agent.approvals.decide(id, "rejected")).toBe(false);
    expect(
      await agent.ask({ conversationKey: key, requestId: "discord:2", text: "approved" }),
    ).toEqual({
      kind: "answer",
      text: "Done.",
    });
    expect(used).toEqual([id]);
    expect(seen[1]).not.toContain("waits for the owner's approval");
    expect(await agent.approvals.decide(id, "used")).toBe(true);
    expect((await agent.approvals.get(id))?.state).toBe("used");
    expect(await agent.approvals.get("99")).toBeUndefined();
  });
});
