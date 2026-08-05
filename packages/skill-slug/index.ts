import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Return the skill command for input that is exactly a known slug, otherwise undefined. */
export function skillSlugCommand(
  text: string,
  hasSlug: (slug: string) => boolean,
): string | undefined {
  const slug = text.trim();
  if (slug === "" || !hasSlug(slug)) return undefined;
  return `/skill:${slug}`;
}

const SKILLS_BLOCK = /<available_skills>([\s\S]*?)<\/available_skills>/u;
const SKILL_NAME = /<name>([^<]*)<\/name>/gu;

/** Extract skill names from the skills block of Pi's assembled system prompt. */
export function skillNamesFromSystemPrompt(systemPrompt: string): string[] {
  const block = SKILLS_BLOCK.exec(systemPrompt);
  if (!block?.[1]) return [];
  const names: string[] = [];
  for (const match of block[1].matchAll(SKILL_NAME)) {
    if (match[1]) names.push(unescapeXml(match[1]));
  }
  return names;
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export default function skillSlug(pi: ExtensionAPI): void {
  let slugs = new Set<string>();
  let primed = false;

  const prime = (systemPrompt: string): void => {
    primed = true;
    slugs = new Set(skillNamesFromSystemPrompt(systemPrompt));
  };

  pi.on("session_start", (_event, ctx) => {
    prime(ctx.getSystemPrompt());
  });

  pi.on("before_agent_start", (event) => {
    const skills = event.systemPromptOptions.skills ?? [];
    if (skills.length > 0) {
      slugs = new Set(skills.map((skill) => skill.name));
    }
    primed = true;
  });

  pi.on("input", (event, ctx) => {
    // Pi skips skill expansion for extension-injected messages; rewriting them would
    // deliver a literal /skill: slug to the model instead of invoking the skill.
    if (event.source === "extension") return { action: "continue" };
    if (!primed) prime(ctx.getSystemPrompt());
    const command = skillSlugCommand(event.text, (slug) => slugs.has(slug));
    if (command === undefined) return { action: "continue" };
    return {
      action: "transform",
      text: command,
      ...(event.images ? { images: event.images } : {}),
    };
  });
}
