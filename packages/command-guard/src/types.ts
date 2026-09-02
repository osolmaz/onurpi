export type ShellKind = "bash" | "powershell" | "cmd" | "unknown";

export type ResolvedWord = Readonly<{
  raw: string;
  value?: string;
  referencedVariables: readonly string[];
  reason?: string;
}>;

export type ParsedCommand = Readonly<{
  name: ResolvedWord;
  args: readonly ResolvedWord[];
  source: string;
}>;

export type ParsedRedirect = Readonly<{
  destination: ResolvedWord;
  operator: string;
  source: string;
}>;

export type ParsedScript = Readonly<{
  commands: readonly ParsedCommand[];
  redirects: readonly ParsedRedirect[];
  assignedVariables: ReadonlySet<string>;
  hasError: boolean;
  source: string;
}>;

export type DestructiveKind =
  | "delete"
  | "recursive-delete"
  | "replace"
  | "truncate"
  | "git-clean"
  | "git-reset";

export type DestructiveOperation = Readonly<{
  command: string;
  kind: DestructiveKind;
  source: string;
  targets: readonly ResolvedWord[];
}>;

export type ObjectIdentity = Readonly<{
  device: string;
  inode: string;
}>;

export type ResolvedTarget = Readonly<{
  canonicalPath: string;
  operandPath: string;
  existed: boolean;
  identity?: ObjectIdentity;
  operandIdentity?: ObjectIdentity;
  source: string;
}>;

export type CommandContext = Readonly<{
  command: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  shell: string;
  shellKind?: ShellKind;
}>;

export type AllowDecision = Readonly<{
  action: "allow";
  operations: readonly DestructiveOperation[];
  referencedEnvironment: Readonly<Record<string, string | undefined>>;
  targets: readonly ResolvedTarget[];
}>;

export type BlockDecision =
  | Readonly<{ action: "deny"; reason: string }>
  | Readonly<{ action: "rewrite"; reason: string }>;

export type PolicyDecision = AllowDecision | BlockDecision;

export type CheckedCall = Readonly<{
  environmentKeys: readonly string[];
  expiresAt: number;
  fingerprint: string;
  targets: readonly ResolvedTarget[];
}>;
