import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AntiRepeatWatcher } from "../src/anti-repeat.ts";
import { listWorkspaceSkills, parseSkillFrontmatter, skillsExtension } from "../src/skills.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

function workspaceWithSkills(skills: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "agent-worker-skills-"));
  folders.push(folder);
  for (const [name, content] of Object.entries(skills)) {
    mkdirSync(join(folder, "skills", name), { recursive: true });
    writeFileSync(join(folder, "skills", name, "SKILL.md"), content);
  }
  return folder;
}

describe("parseSkillFrontmatter", () => {
  it("reads the name and description fields", () => {
    const fields = parseSkillFrontmatter(
      "---\nname: my-skill\ndescription: Does a thing.\n---\n\n# Body",
    );
    expect(fields).toEqual({ name: "my-skill", description: "Does a thing." });
  });

  it("returns an empty object without frontmatter", () => {
    expect(parseSkillFrontmatter("# No frontmatter")).toEqual({});
  });
});

describe("listWorkspaceSkills", () => {
  it("lists each skill folder with its fields and path", () => {
    const folder = workspaceWithSkills({
      first: "---\nname: first-skill\ndescription: The first one.\n---\nBody",
      second: "---\nname: second-skill\ndescription: The second one.\n---\nBody",
    });
    const skills = listWorkspaceSkills(join(folder, "skills"));
    expect(skills.map((skill) => skill.name).sort()).toEqual(["first-skill", "second-skill"]);
    expect(skills.every((skill) => skill.path.endsWith("SKILL.md"))).toBe(true);
  });

  it("falls back to the folder name for an invalid name", () => {
    const folder = workspaceWithSkills({
      "keep-folder": "---\nname: BAD NAME\ndescription: X\n---\n",
    });
    expect(listWorkspaceSkills(join(folder, "skills")).at(0)?.name).toBe("keep-folder");
  });

  it("returns an empty list without a skills folder", () => {
    const folder = mkdtempSync(join(tmpdir(), "agent-worker-skills-"));
    folders.push(folder);
    expect(listWorkspaceSkills(join(folder, "skills"))).toEqual([]);
  });
});

describe("skillsExtension", () => {
  type SectionHolder = {
    sections: { key: string; render: () => string | undefined }[];
  };

  it("renders one line per skill", () => {
    const folder = workspaceWithSkills({
      deploy: "---\nname: deploy\ndescription: Ships the release.\n---\nBody",
    });
    const extension = skillsExtension(folder) as unknown as SectionHolder;
    expect(extension.sections.map((item) => item.key)).toEqual(["workspace-skills"]);
    const rendered = extension.sections[0]?.render();
    expect(rendered).toContain("deploy: Ships the release.");
    expect(rendered).toContain("When a task matches one");
  });

  it("omits the section when the workspace has no skills", () => {
    const folder = mkdtempSync(join(tmpdir(), "agent-worker-skills-"));
    folders.push(folder);
    const extension = skillsExtension(folder) as unknown as SectionHolder;
    expect(extension.sections[0]?.render()).toBeUndefined();
  });
});

function assistantEntry(message: Record<string, unknown>): {
  entry: { model: Record<string, unknown>[] };
  type: "message_end";
} {
  return { entry: { model: [message] }, type: "message_end" };
}

/** Feeds one run that ends with the same terminal error. */
function errorRun(watcher: AntiRepeatWatcher): ReturnType<AntiRepeatWatcher["feed"]> {
  watcher.feed([{ type: "run_start" } as never]);
  watcher.feed([
    assistantEntry({ role: "assistant", stopReason: "error", errorMessage: "boom" }) as never,
    { type: "turn_end" } as never,
  ]);
  return watcher.feed([{ type: "run_end" } as never]);
}

describe("AntiRepeatWatcher", () => {
  it("reports the same error ending three runs as one correction", () => {
    const watcher = new AntiRepeatWatcher();
    watcher.onNewInput("please work on the thing");
    expect(errorRun(watcher)).toBeNull();
    expect(errorRun(watcher)).toBeNull();
    const feedback = errorRun(watcher);
    expect(feedback).toMatchObject({ action: "correct", activeResponse: false });
    expect(watcher.correction(feedback?.detection ?? (null as never))).toContain(
      "Anti-Repeat detected repeated work.",
    );
  });

  it("stops at the second detection of an epoch", () => {
    const watcher = new AntiRepeatWatcher();
    watcher.onNewInput("please work on the thing");
    for (let run = 0; run < 2; run++) expect(errorRun(watcher)).toBeNull();
    expect(errorRun(watcher)).toMatchObject({ action: "correct" });
    expect(errorRun(watcher)).toMatchObject({ action: "stop" });
  });

  it("a new instruction starts a new epoch", () => {
    const watcher = new AntiRepeatWatcher();
    watcher.onNewInput("please work on the thing");
    for (let run = 0; run < 2; run++) expect(errorRun(watcher)).toBeNull();
    expect(errorRun(watcher)).toMatchObject({ action: "correct" });
    watcher.onNewInput("a different task entirely");
    for (let run = 0; run < 2; run++) expect(errorRun(watcher)).toBeNull();
    expect(errorRun(watcher)).toMatchObject({ action: "correct" });
  });

  it("keeps continuation prompts in the same epoch", () => {
    const watcher = new AntiRepeatWatcher();
    watcher.onNewInput("please work on the thing");
    for (let run = 0; run < 2; run++) expect(errorRun(watcher)).toBeNull();
    expect(errorRun(watcher)).toMatchObject({ action: "correct" });
    // The continuation does not reset the epoch, so the next identical error stops it.
    watcher.onNewInput("continue");
    expect(errorRun(watcher)).toMatchObject({ action: "stop" });
  });

  it("detects a repeated reasoning window while the response streams", () => {
    const watcher = new AntiRepeatWatcher({
      reasoning: { windowWords: 8, repeats: 3, matchedWindows: 1, sampleRate: 1 },
    });
    watcher.onNewInput("think about the puzzle");
    watcher.feed([{ type: "run_start" } as never]);
    watcher.feed([{ changes: [{ type: "thinking_start" }], type: "message_update" } as never]);
    const phrase = "the answer must be forty two widgets for the customer order today ";
    const feedback = watcher.feed([
      {
        changes: [{ delta: phrase.repeat(3), type: "thinking_delta" }],
        type: "message_update",
      } as never,
    ]);
    expect(feedback).toMatchObject({ action: "correct", activeResponse: true });
  });
});
