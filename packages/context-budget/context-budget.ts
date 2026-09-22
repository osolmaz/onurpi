/**
 * Pure measurement and message helpers for the context budget.
 *
 * The budget covers the fixed beginning of every request: Pi's system prompt (preamble, tool list,
 * guidelines, docs, project instructions, skills) plus the serialized tool declarations. Conversation
 * messages are reported separately because Pi already tracks them with `ctx.getContextUsage()`.
 *
 * Nothing here calls Pi APIs, so every rule is unit-testable.
 */

import { createHash } from "node:crypto";

export type ContextBudgetConfig = {
  enabled: boolean;
  warnChars: number;
  /** Token warning threshold, or 0 to disable it. */
  warnTokens: number;
  charsPerToken: number;
  status: boolean;
  notify: boolean;
};

export const DEFAULT_CONFIG: ContextBudgetConfig = {
  enabled: true,
  warnChars: 100_000,
  warnTokens: 24_000,
  charsPerToken: 4,
  status: true,
  notify: true,
};

/** One measured item: a prompt section, a tool declaration, or a comparable row. */
export type SizedItem = {
  name: string;
  chars: number;
};

/** The one-line warning names only the biggest few parts, and ignores small ones. */
export const WARNING_ITEM_LIMIT = 4;
const WARNING_ITEM_MIN_CHARS = 1_000;

export type ContextFileSize = {
  path: string;
  chars: number;
  hash: string;
};

export type DuplicateGroup = {
  paths: string[];
  chars: number;
  copies: number;
};

/** The parts of a tool definition that a provider payload carries. */
export type ToolDeclaration = {
  name: string;
  description?: unknown;
  parameters?: unknown;
};

export type ToolSource = "metadata" | "request";

export type ContextMeasurement = {
  promptChars: number;
  toolChars: number;
  totalChars: number;
  sections: SizedItem[];
  files: ContextFileSize[];
  skillCount: number;
  tools: SizedItem[];
  toolSource: ToolSource;
};

const SECTION_PATTERN = /<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>\n([\s\S]*?)\n<\/\1>/g;
const CONTEXT_FILE_PATTERN =
  /<project_instructions path="([^"]*)">\n([\s\S]*?)\n<\/project_instructions>/g;

function sectionChars(prompt: string): { preambleChars: number; sections: SizedItem[] } {
  const sections: SizedItem[] = [];
  let firstTagIndex = -1;
  for (const match of prompt.matchAll(SECTION_PATTERN)) {
    const name = match[1] ?? "";
    const body = match[2] ?? "";
    if (firstTagIndex < 0) firstTagIndex = match.index;
    sections.push({ name, chars: body.length });
  }
  const head = firstTagIndex < 0 ? prompt : prompt.slice(0, firstTagIndex);
  return { preambleChars: head.trimEnd().length, sections };
}

export function countSkills(prompt: string): number {
  return prompt.match(/<skill>/g)?.length ?? 0;
}

/** Measure the rendered system prompt: untagged preamble, tagged sections, and skill entries. */
export function measurePrompt(prompt: string): {
  promptChars: number;
  sections: SizedItem[];
  skillCount: number;
} {
  const { preambleChars, sections } = sectionChars(prompt);
  const items =
    preambleChars > 0 ? [{ name: "preamble", chars: preambleChars }, ...sections] : sections;
  return { promptChars: prompt.length, sections: items, skillCount: countSkills(prompt) };
}

/** Serialize one tool declaration the way a provider payload carries it. */
export function toolDeclaration(tool: ToolDeclaration): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.parameters ?? {},
  });
}

export function measureTools(tools: readonly ToolDeclaration[]): SizedItem[] {
  return tools
    .map((tool) => ({ name: tool.name, chars: toolDeclaration(tool).length }))
    .sort((left, right) => right.chars - left.chars);
}

/** Measure the raw request payload tool array, which is what the provider actually receives. */
export function measureRequestTools(payload: unknown): SizedItem[] {
  if (typeof payload !== "object" || payload === null) return [];
  const tools = (payload as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((entry) => {
      const name =
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name
          : "(unnamed)";
      return { name, chars: JSON.stringify(entry).length };
    })
    .sort((left, right) => right.chars - left.chars);
}

/** Read the context-file blocks that Pi already rendered into the system prompt. */
export function parseContextFiles(prompt: string): { path: string; content: string }[] {
  return [...prompt.matchAll(CONTEXT_FILE_PATTERN)].map((match) => ({
    path: match[1] ?? "(unknown)",
    content: match[2] ?? "",
  }));
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function measureContextFiles(
  files: readonly { path: string; content: string }[],
): ContextFileSize[] {
  return files.map((file) => ({
    path: file.path,
    chars: file.content.length,
    hash: contentHash(file.content),
  }));
}

/** Find files with identical content, which Pi sends as separate prompt blocks. */
export function duplicateGroups(files: readonly ContextFileSize[]): DuplicateGroup[] {
  const byHash = new Map<string, ContextFileSize[]>();
  for (const file of files) {
    const group = byHash.get(file.hash);
    if (group === undefined) byHash.set(file.hash, [file]);
    else group.push(file);
  }
  const groups: DuplicateGroup[] = [];
  for (const group of byHash.values()) {
    const first = group[0];
    if (group.length > 1 && first !== undefined) {
      groups.push({
        paths: group.map((file) => file.path),
        chars: first.chars * group.length,
        copies: group.length,
      });
    }
  }
  return groups.sort((left, right) => right.chars - left.chars);
}

export type MeasureInput = {
  prompt: string;
  tools?: readonly ToolDeclaration[];
  requestTools?: readonly SizedItem[];
  files?: readonly { path: string; content: string }[];
};

export function measureContext(input: MeasureInput): ContextMeasurement {
  const prompt = measurePrompt(input.prompt);
  const files =
    input.files !== undefined && input.files.length > 0
      ? input.files
      : parseContextFiles(input.prompt);
  const requestTools = input.requestTools ?? [];
  const fromRequest = requestTools.length > 0;
  const tools = fromRequest ? [...requestTools] : measureTools(input.tools ?? []);
  const toolChars = tools.reduce((total, tool) => total + tool.chars, 0);
  return {
    promptChars: prompt.promptChars,
    toolChars,
    totalChars: prompt.promptChars + toolChars,
    sections: prompt.sections,
    files: measureContextFiles(files),
    skillCount: prompt.skillCount,
    tools,
    toolSource: fromRequest ? "request" : "metadata",
  };
}

export function estimateTokens(chars: number, charsPerToken: number): number {
  if (charsPerToken <= 0) return chars;
  return Math.ceil(chars / charsPerToken);
}

export function overBudget(measurement: ContextMeasurement, config: ContextBudgetConfig): boolean {
  return overBudgetReasons(measurement, config).length > 0;
}

export function overBudgetReasons(
  measurement: ContextMeasurement,
  config: ContextBudgetConfig,
): string[] {
  const reasons: string[] = [];
  if (config.warnChars > 0 && measurement.totalChars > config.warnChars) {
    reasons.push(`over ${formatCount(config.warnChars)} characters`);
  }
  const tokens = estimateTokens(measurement.totalChars, config.charsPerToken);
  if (config.warnTokens > 0 && tokens > config.warnTokens) {
    reasons.push(`over ${formatCount(config.warnTokens)} tokens`);
  }
  return reasons;
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Rank the prompt sections and the serialized tool declarations together, largest first, so the
 * warning shows where the beginning context actually goes.
 */
export function largestContributors(measurement: ContextMeasurement): SizedItem[] {
  const items: SizedItem[] = [
    ...measurement.sections,
    { name: "tool declarations", chars: measurement.toolChars },
  ];
  return items
    .filter((item) => item.chars >= WARNING_ITEM_MIN_CHARS)
    .sort((left, right) => right.chars - left.chars)
    .slice(0, WARNING_ITEM_LIMIT);
}

function contributorPhrase(measurement: ContextMeasurement): string {
  const items = largestContributors(measurement);
  if (items.length === 0) return "";
  const parts = items.map((item) => `${item.name} ${formatCount(item.chars)}`);
  return `Largest: ${parts.join(", ")}. `;
}

export function budgetWarning(
  measurement: ContextMeasurement,
  config: ContextBudgetConfig,
): string | undefined {
  if (!config.enabled || !config.notify) return undefined;
  const reasons = overBudgetReasons(measurement, config);
  if (reasons.length === 0) return undefined;
  const tokens = estimateTokens(measurement.totalChars, config.charsPerToken);
  return [
    `context-budget: beginning context is ${formatCount(measurement.totalChars)} chars`,
    `(~${formatCount(tokens)} tokens), ${reasons.join(" and ")}.`,
    `${contributorPhrase(measurement)}Run /context-budget for the details.`,
  ].join(" ");
}

export function statusText(
  measurement: ContextMeasurement | undefined,
  config: ContextBudgetConfig,
): string | undefined {
  if (!config.enabled || !config.status || measurement === undefined) return undefined;
  const tokens = estimateTokens(measurement.totalChars, config.charsPerToken);
  const over = overBudgetReasons(measurement, config).length > 0 ? "!" : "";
  return `context${over} ${formatCount(measurement.totalChars)}ch ~${formatCount(tokens)}tok`;
}

function sectionLine(measurement: ContextMeasurement): string {
  const parts = measurement.sections
    .slice()
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 6)
    .map((section) => `${section.name} ${formatCount(section.chars)}`);
  return parts.length > 0 ? `sections: ${parts.join(" ")}` : "sections: none";
}

function fileLines(measurement: ContextMeasurement): string[] {
  if (measurement.files.length === 0) return ["context files: none"];
  const total = measurement.files.reduce((sum, file) => sum + file.chars, 0);
  const lines = [
    `context files: ${String(measurement.files.length)} files, ${formatCount(total)} chars`,
  ];
  for (const group of duplicateGroups(measurement.files)) {
    lines.push(
      `  duplicate content: ${group.paths.join(", ")} (${String(group.copies)} x ${formatCount(group.chars / group.copies)} chars)`,
    );
  }
  const largest = measurement.files
    .slice()
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 5);
  for (const file of largest) lines.push(`  ${file.path} ${formatCount(file.chars)} chars`);
  return lines;
}

function toolLines(measurement: ContextMeasurement): string[] {
  const source = measurement.toolSource === "request" ? "provider payload" : "tool metadata";
  const lines = [`tools: ${formatCount(measurement.toolChars)} chars (${source})`];
  const largest = measurement.tools.slice(0, 5);
  if (largest.length > 0) {
    lines.push(
      `  largest: ${largest.map((tool) => `${tool.name} ${formatCount(tool.chars)}`).join(" ")}`,
    );
  }
  return lines;
}

export type ReportInput = {
  configPath: string;
  config: ContextBudgetConfig;
  measurement: ContextMeasurement | undefined;
  errors: readonly string[];
  conversationTokens?: number | undefined;
  contextWindow?: number | undefined;
};

export function reportLines(input: ReportInput): string[] {
  const { config, measurement } = input;
  const state = config.enabled ? "enabled" : "disabled";
  const lines = [`context-budget: ${state}`, `config: ${input.configPath}`];
  if (measurement === undefined) {
    lines.push("beginning context: not measured yet");
  } else {
    const tokens = estimateTokens(measurement.totalChars, config.charsPerToken);
    lines.push(
      `beginning context: ${String(measurement.promptChars)} chars prompt + ${String(measurement.toolChars)} chars tools`,
    );
    lines.push(
      `  total ${String(measurement.totalChars)} chars ~${String(tokens)} tokens (warn above ${String(config.warnChars)} chars / ${String(config.warnTokens)} tokens)`,
    );
    lines.push(sectionLine(measurement));
    lines.push(...fileLines(measurement));
    lines.push(...toolLines(measurement));
  }
  if (input.conversationTokens != null) {
    const window = input.contextWindow == null ? "?" : String(input.contextWindow);
    lines.push(`conversation now: ${String(input.conversationTokens)} / ${window} tokens`);
  }
  if (input.errors.length > 0) lines.push(`config problems: ${input.errors.join("; ")}`);
  return lines;
}
