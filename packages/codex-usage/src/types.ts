import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type UsageSource = "pi-auth" | "codex-app-server";
export type PiModel = NonNullable<ExtensionContext["model"]>;
type AuthResult = Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;

export type UsageQueryContext = {
  model: ExtensionContext["model"];
  modelRegistry: {
    getAll: () => PiModel[];
    getApiKeyAndHeaders: (model: PiModel) => Promise<AuthResult>;
    getAvailable: () => PiModel[];
  };
};

export type QueryUsageOptions = {
  refresh: boolean;
  timeoutMs: number;
};

export type CachedReport = {
  createdAt: number;
  report: CodexUsageReport;
};

export type QueryUsageResult =
  | { ok: true; report: CodexUsageReport }
  | { ok: false; errors: UsageQueryError[] };

export type UsageQueryError = {
  source: UsageSource;
  message: string;
  cause?: unknown;
};

export type CodexUsageReport = {
  source: UsageSource;
  capturedAt: number;
  planType?: string;
  snapshots: NormalizedRateLimitSnapshot[];
  resetCredits?: NormalizedRateLimitResetCredits;
};

export type NormalizedRateLimitResetCredits = {
  availableCount: number;
  credits?: NormalizedRateLimitResetCredit[];
};

export type NormalizedRateLimitResetCredit = {
  id: string;
  resetType?: string;
  status?: string;
  grantedAt?: number;
  expiresAt?: number;
  title?: string;
  description?: string;
};

export type NormalizedRateLimitSnapshot = {
  limitId: string;
  limitName?: string;
  primary?: NormalizedRateLimitWindow;
  secondary?: NormalizedRateLimitWindow;
  credits?: NormalizedCredits;
};

export type NormalizedRateLimitWindow = {
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
};

export type NormalizedCredits = {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
};

export type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
