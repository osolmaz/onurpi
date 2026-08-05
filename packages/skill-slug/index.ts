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

export default function skillSlug(pi: ExtensionAPI): void {
  let slugs = new Set<string>();

  pi.on("before_agent_start", (event) => {
    slugs = new Set((event.systemPromptOptions.skills ?? []).map((skill) => skill.name));
  });

  pi.on("input", (event) => {
    // Pi skips skill expansion for extension-injected messages; rewriting them would
    // deliver a literal /skill: slug to the model instead of invoking the skill.
    if (event.source === "extension") return { action: "continue" };
    const command = skillSlugCommand(event.text, (slug) => slugs.has(slug));
    if (command === undefined) return { action: "continue" };
    return {
      action: "transform",
      text: command,
      ...(event.images ? { images: event.images } : {}),
    };
  });
}
