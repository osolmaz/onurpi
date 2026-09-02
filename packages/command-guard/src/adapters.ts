const GUARDED_TOOLS = new Set(["bash", "powershell", "exec_command", "write_stdin"]);
const COMMAND_FIELDS = new Set(["cmd", "command", "script"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SchemaTool = Readonly<{ parameters: unknown }>;
type CoverageTool = SchemaTool & Readonly<{ name: string }>;
export type CoverageAPI = Readonly<{
  getAllTools(): readonly CoverageTool[];
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}>;

function schemaProperties(tool: SchemaTool): Record<string, unknown> | undefined {
  if (!isRecord(tool.parameters)) return undefined;
  const properties = tool.parameters["properties"];
  return isRecord(properties) ? properties : undefined;
}

export function hasCommandSchema(tool: SchemaTool): boolean {
  const properties = schemaProperties(tool);
  return properties !== undefined && [...COMMAND_FIELDS].some((name) => name in properties);
}

export function commandField(input: Record<string, unknown>): string | undefined {
  for (const name of COMMAND_FIELDS) {
    const value = input[name];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export class AdapterCoverage {
  readonly #pi: CoverageAPI;
  #disabled: string[] = [];

  constructor(pi: CoverageAPI) {
    this.#pi = pi;
  }

  enforce(): void {
    const tools = this.#pi.getAllTools();
    const unsupported = new Set(
      tools
        .filter((tool) => !GUARDED_TOOLS.has(tool.name) && hasCommandSchema(tool))
        .map((tool) => tool.name),
    );
    const active = this.#pi.getActiveTools();
    const filtered = active.filter((name) => !unsupported.has(name));
    if (filtered.length !== active.length) this.#pi.setActiveTools(filtered);
    this.#disabled = [...unsupported].sort();
  }

  isGuarded(toolName: string): boolean {
    return GUARDED_TOOLS.has(toolName);
  }

  get disabled(): readonly string[] {
    return this.#disabled;
  }
}
