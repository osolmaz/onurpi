export const OUTPUT_SCHEMA = "pi-session/v1";
export const MESSAGE_EXCERPT_BYTES = 2 * 1024;
export const CONTROL_EXCERPT_BYTES = 8 * 1024;
export const TOTAL_OUTPUT_BYTES = 40 * 1024;

export const ASSISTANT_MODES = ["final", "text", "none"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const OUTPUT_FORMATS = ["text", "json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const INCLUDE_KINDS = ["workflow", "plan", "errors", "files"] as const;
export type IncludeKind = (typeof INCLUDE_KINDS)[number];

export type RecoveryOptions = {
  readonly last: number;
  readonly assistant: AssistantMode;
  readonly include: ReadonlySet<IncludeKind>;
  readonly since?: string;
  readonly format: OutputFormat;
  readonly allProjects: boolean;
};

export type ParsedCommand =
  | { readonly kind: "help" }
  | {
      readonly kind: "show";
      readonly session: string;
      readonly options: RecoveryOptions;
    }
  | {
      readonly kind: "list";
      readonly allProjects: boolean;
      readonly limit: number;
      readonly format: OutputFormat;
    }
  | {
      readonly kind: "entry";
      readonly session: string;
      readonly entryId: string;
      readonly allProjects: boolean;
      readonly format: OutputFormat;
    };

export type IntegritySeverity = "warning" | "error";

export type IntegrityIssue = {
  readonly code: string;
  readonly severity: IntegritySeverity;
  readonly message: string;
  readonly entryId?: string;
  readonly line?: number;
};

export type IntegrityReport = {
  readonly status: "ok" | "issues";
  readonly issues: readonly IntegrityIssue[];
  readonly omittedIssues: number;
};

export type Excerpt = {
  readonly text: string;
  readonly originalBytes: number;
  readonly shownBytes: number;
  readonly omittedBytes: number;
  readonly truncated: boolean;
  readonly redactions: number;
  readonly omissions: readonly string[];
};

export type EntryReference = {
  readonly entryId: string;
  readonly timestamp: string;
};

export type UserEvidence = EntryReference & {
  readonly text: Excerpt;
};

export type AssistantEvidence = EntryReference & {
  readonly kind: "intermediate" | "final";
  readonly text: Excerpt;
};

export type AssistantSelection = {
  readonly status: "complete" | "interrupted" | "omitted";
  readonly messages: readonly AssistantEvidence[];
};

export type ControlEvent = EntryReference & {
  readonly kind: IncludeKind;
  readonly toolName: string;
  readonly phase: "call" | "result";
  readonly action?: string;
  readonly text: Excerpt;
};

export type TurnEvidence = {
  readonly number: number;
  readonly entryIds: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly user: UserEvidence;
  readonly assistant: AssistantSelection;
  readonly control: readonly ControlEvent[];
};

export type SessionSummary = {
  readonly id: string;
  readonly file: string;
  readonly cwd: string;
  readonly version: number | null;
  readonly entries: number;
  readonly activeBranchEntries: number;
};

export type SelectionSummary = {
  readonly assistant: AssistantMode;
  readonly include: readonly IncludeKind[];
  readonly requestedLast: number;
  readonly since: string | null;
  readonly totalTurns: number;
  readonly selectedTurns: number;
  readonly omittedTurns: number;
  readonly omittedControlEvents: number;
  readonly outputTruncated: boolean;
};

export type RecoveryDocument = {
  readonly schema: typeof OUTPUT_SCHEMA;
  readonly session: SessionSummary;
  readonly integrity: IntegrityReport;
  readonly selection: SelectionSummary;
  readonly turns: readonly TurnEvidence[];
  readonly nextOffset: number | null;
};

export type SessionListItem = {
  readonly id: string;
  readonly path: string;
  readonly cwd: string;
  readonly name: string | null;
  readonly created: string;
  readonly modified: string;
  readonly messageCount: number;
  readonly firstMessage: Excerpt;
};

export type SessionListDocument = {
  readonly schema: typeof OUTPUT_SCHEMA;
  readonly scope: "cwd" | "all-projects";
  readonly cwd: string;
  readonly limit: number;
  readonly totalSessions: number;
  readonly omittedSessions: number;
  readonly sessions: readonly SessionListItem[];
};

export type EntryDocument = {
  readonly schema: typeof OUTPUT_SCHEMA;
  readonly session: SessionSummary;
  readonly integrity: IntegrityReport;
  readonly entry: {
    readonly id: string;
    readonly parentId: string | null;
    readonly timestamp: string;
    readonly type: string;
    readonly summary: Excerpt;
  } | null;
};

export type RawRecord = Readonly<Record<string, unknown>>;

export type SafeEntry = {
  readonly raw: RawRecord;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: string;
  readonly type: string;
};

export type ScanResult = {
  readonly firstParsed: unknown;
  readonly malformedLines: readonly number[];
  readonly malformedLineCount: number;
  readonly oversizedLines: readonly number[];
  readonly oversizedLineCount: number;
};

export type LoadedSession = {
  readonly path: string;
  readonly id: string;
  readonly cwd: string;
  readonly version: number | null;
  readonly entries: readonly SafeEntry[];
  readonly branch: readonly SafeEntry[];
  readonly integrity: IntegrityReport;
};
