import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadReviewerApp, selectAppModel } from "../src/app.js";
import { runReview } from "../src/runner.js";

const cleanup: string[] = [];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OUTPUT = {
  findings: [
    {
      title: "[P1] Preserve the completion result",
      body: "The second completion path overwrites the first result.",
      confidence_score: 0.91,
      priority: 1,
      code_location: {
        absolute_file_path: "/repo/src/run.ts",
        line_range: { start: 10, end: 11 },
      },
    },
  ],
  overall_correctness: "patch is incorrect",
  overall_explanation: "One urgent defect remains.",
  overall_confidence_score: 0.9,
};

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function fakePi(
  exitCode = 0,
): Promise<{ root: string; command: readonly string[]; argsFile: string; offlineFile: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-fake-"));
  cleanup.push(root);
  const script = path.join(root, "fake-pi.mjs");
  const argsFile = path.join(root, "args.json");
  const offlineFile = path.join(root, "offline.txt");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.env.PI_REVIEWER_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
writeFileSync(process.env.PI_REVIEWER_OFFLINE_FILE, process.env.PI_OFFLINE ?? "");
if (${String(exitCode)} !== 0) process.exit(${String(exitCode)});
const output = process.env.PI_REVIEWER_OUTPUT;
console.log(JSON.stringify({type:"session", version:3, id:"fake", cwd:process.cwd()}));
console.log(JSON.stringify({type:"message_end", message:{role:"assistant", stopReason:"stop", content:[{type:"text", text:output}]}}));
console.log(JSON.stringify({type:"agent_end", messages:[]}));
`,
  );
  await chmod(script, 0o755);
  return { root, command: [process.execPath, script], argsFile, offlineFile };
}

describe("Pi Reviewer app", () => {
  it("loads the Pi Factory bundle without hard-coding a model in the extension", async () => {
    const fake = await fakePi();
    const app = await loadReviewerApp({ packageRoot, piCommand: fake.command });
    expect(app.extensions).toHaveLength(1);
    expect(app.forwardedArgs).toContain("--no-extensions");
    const extension = await readFile(
      path.join(packageRoot, "extensions", "review-guard.ts"),
      "utf8",
    );
    expect(extension).not.toMatch(/gpt-|claude|gemini|openai-codex/u);
    expect(
      selectAppModel(app, { provider: "provider", model: "model", thinking: "low" }),
    ).toMatchObject({ defaultProvider: "provider", defaultModel: "model", thinking: "low" });
  });

  it("runs an ephemeral JSON review with an externally selected model", async () => {
    const fake = await fakePi();
    const loaded = await loadReviewerApp({ packageRoot, piCommand: fake.command });
    const stateDir = path.join(fake.root, "state");
    const app = {
      ...loaded,
      stateDir,
      sessionDir: path.join(stateDir, "sessions"),
      env: {
        PI_REVIEWER_ARGS_FILE: fake.argsFile,
        PI_REVIEWER_OFFLINE_FILE: fake.offlineFile,
        PI_REVIEWER_OUTPUT: JSON.stringify(OUTPUT),
      },
    };
    const previousOffline = process.env["PI_OFFLINE"];
    process.env["PI_OFFLINE"] = "0";
    const result = await runReview({
      app,
      selection: { provider: "openai-codex", model: "external-review-model", thinking: "high" },
      cwd: fake.root,
      prompt: "Review the change",
    }).finally(() => {
      if (previousOffline === undefined) delete process.env["PI_OFFLINE"];
      else process.env["PI_OFFLINE"] = previousOffline;
    });
    expect(result.findings[0]?.priority).toBe(1);
    const args = JSON.parse(await readFile(fake.argsFile, "utf8")) as string[];
    expect(args).toContain("--no-session");
    expect(args).toContain("openai-codex");
    expect(args).toContain("external-review-model");
    expect(args).toContain("high");
    expect(args).toContain("Review the change");
    expect(await readFile(fake.offlineFile, "utf8")).toBe("1");
    await expect(readFile(path.join(stateDir, "sessions", "session.jsonl"))).rejects.toThrow();
  });

  it("surfaces child failure instead of returning a clean review", async () => {
    const fake = await fakePi(2);
    const loaded = await loadReviewerApp({ packageRoot, piCommand: fake.command });
    const app = {
      ...loaded,
      stateDir: path.join(fake.root, "state"),
      sessionDir: path.join(fake.root, "sessions"),
      env: {
        PI_REVIEWER_ARGS_FILE: fake.argsFile,
        PI_REVIEWER_OFFLINE_FILE: fake.offlineFile,
        PI_REVIEWER_OUTPUT: JSON.stringify(OUTPUT),
      },
    };
    await expect(
      runReview({
        app,
        selection: { provider: "openai-codex", model: "external-review-model", thinking: "high" },
        cwd: fake.root,
        prompt: "Review",
      }),
    ).rejects.toThrow("status 2");
  });

  it("keeps the vendored Codex rubric byte-for-byte except for the review-shell note", async () => {
    const prompt = await readFile(path.join(packageRoot, "prompts", "review-system.md"), "utf8");
    const localLine =
      "* Use `review_shell` for read-only Git and repository inspection commands. Shell pipelines, redirection, network access, and mutation are unavailable.\n";
    const upstream = prompt.replace(localLine, "");
    expect(createHash("sha256").update(upstream).digest("hex")).toBe(
      "ec60e7f36a1d1c2679ce095c0205ecc56f7dd8fb57707a13ef362072390f219f",
    );
  });
});
