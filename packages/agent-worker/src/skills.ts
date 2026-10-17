import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";

/** A skill folder's `SKILL.md`, reduced to what the prompt section shows. */
export type WorkspaceSkill = {
  readonly name: string;
  readonly description: string;
  /** Workspace-relative path of the full `SKILL.md`. */
  readonly path: string;
};

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function frontmatterOf(content: string): string | undefined {
  return /^---\r?\n(.*?)\r?\n---/su.exec(content)?.[1];
}

function fieldOf(frontmatter: string, field: "name" | "description"): string | undefined {
  for (const line of frontmatter.split(/\r?\n/)) {
    const pair = RegExp(`^${field}:\\s*(.*)$`, "u").exec(line);
    if (pair !== null) return pair[1]?.trim();
  }
  return undefined;
}

/** Parses the `name` and `description` fields of a `SKILL.md` frontmatter block. */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const frontmatter = frontmatterOf(content);
  if (frontmatter === undefined) return {};
  const fields: { name?: string; description?: string } = {};
  const name = fieldOf(frontmatter, "name");
  const description = fieldOf(frontmatter, "description");
  if (name !== undefined) fields.name = name;
  if (description !== undefined) fields.description = description;
  return fields;
}

function readSkill(child: string, skillsDir: string): WorkspaceSkill | undefined {
  const file = join(skillsDir, child, "SKILL.md");
  let content: string;
  try {
    if (!statSync(join(skillsDir, child)).isDirectory()) return undefined;
    content = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const fields = parseSkillFrontmatter(content);
  const name = fields.name !== undefined && NAME_PATTERN.test(fields.name) ? fields.name : child;
  return { description: fields.description ?? "", name, path: file };
}

/**
 * Finds the workspace's skills: directories under `skills/` that hold a `SKILL.md`, per the Agent
 * Skills discovery rules. An invalid name falls back to the folder name.
 */
export function listWorkspaceSkills(skillsDir: string): WorkspaceSkill[] {
  let children: string[];
  try {
    children = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const skills: WorkspaceSkill[] = [];
  for (const child of children.sort()) {
    const skill = readSkill(child, skillsDir);
    if (skill !== undefined) skills.push(skill);
  }
  return skills;
}

/**
 * The workspace's skills as a prompt section. Each entry shows the name and description with the
 * `SKILL.md` path; the model loads the full file with `read` when a task matches. The folder is
 * read for every request, so a skill added or removed applies to the next answer.
 */
export function skillsExtension(workspace: string) {
  const skillsDir = join(workspace, "skills");
  return defineExtension({
    name: "skills",
    sections: [
      section("workspace-skills", () => {
        const skills = listWorkspaceSkills(skillsDir);
        if (skills.length === 0) return undefined;
        return [
          "The workspace has the following skills for specific tasks.",
          "When a task matches one, read its SKILL.md file with `read` and follow it before you act.",
          "",
          ...skills.map(
            (skill) =>
              `- ${skill.name}: ${skill.description || "(no description)"} — ${skill.path}`,
          ),
        ].join("\n");
      }),
    ],
  });
}
