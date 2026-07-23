import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CODEX_PROVIDER_ID, CODEX_WEEKLY_STATUS_ID } from "./constants.js";
import type { UsageService } from "./usage-service.js";
import type {
  CodexUsageReport,
  NormalizedRateLimitSnapshot,
  NormalizedRateLimitWindow,
  PiModel,
  UsageQueryContext,
} from "./types.js";

export { CODEX_PROVIDER_ID, CODEX_WEEKLY_STATUS_ID } from "./constants.js";

const AUTOMATIC_QUERY_TIMEOUT_MS = 15_000;
const WEEK_MINUTES = 10_080;

type WeeklyStatusContext = UsageQueryContext & {
  ui: Pick<ExtensionContext["ui"], "setStatus">;
};

export type WeeklyStatusController = {
  clear: (ctx: WeeklyStatusContext) => void;
  publish: (ctx: WeeklyStatusContext, report: CodexUsageReport, model?: PiModel) => void;
  sync: (ctx: WeeklyStatusContext, model?: PiModel) => Promise<void>;
};

export function createWeeklyStatusController(service: UsageService): WeeklyStatusController {
  let revision = 0;

  const setStatus = (ctx: WeeklyStatusContext, status: string | undefined): void => {
    ctx.ui.setStatus(CODEX_WEEKLY_STATUS_ID, status);
  };

  const clear = (ctx: WeeklyStatusContext): void => {
    revision += 1;
    setStatus(ctx, undefined);
  };

  const publish = (ctx: WeeklyStatusContext, report: CodexUsageReport, model = ctx.model): void => {
    revision += 1;
    setStatus(ctx, isCodexModel(model) ? formatWeeklyRemaining(report) : undefined);
  };

  const sync = async (ctx: WeeklyStatusContext, model = ctx.model): Promise<void> => {
    const requestRevision = ++revision;
    if (!isCodexModel(model)) {
      setStatus(ctx, undefined);
      return;
    }

    try {
      const result = await service.read(ctx, {
        refresh: false,
        timeoutMs: AUTOMATIC_QUERY_TIMEOUT_MS,
      });
      if (requestRevision !== revision) return;
      setStatus(ctx, result.ok ? formatWeeklyRemaining(result.report) : undefined);
    } catch {
      if (requestRevision === revision) setStatus(ctx, undefined);
    }
  };

  return { clear, publish, sync };
}

export function isCodexModel(model: PiModel | undefined): boolean {
  return model?.provider === CODEX_PROVIDER_ID;
}

export function formatWeeklyRemaining(report: CodexUsageReport): string | undefined {
  const snapshot = primaryCodexSnapshot(report.snapshots);
  const window = snapshot ? weeklyWindow(snapshot) : undefined;
  if (!window) return undefined;
  return `${String(Math.round(100 - clampPercent(window.usedPercent)))}% wk`;
}

function primaryCodexSnapshot(
  snapshots: readonly NormalizedRateLimitSnapshot[],
): NormalizedRateLimitSnapshot | undefined {
  return snapshots.find(
    (snapshot) =>
      normalizedUsageKey(snapshot.limitId) === "codex" ||
      normalizedUsageKey(snapshot.limitName) === "codex",
  );
}

function weeklyWindow(
  snapshot: NormalizedRateLimitSnapshot,
): NormalizedRateLimitWindow | undefined {
  const exact = [snapshot.primary, snapshot.secondary].find(
    (window) => window?.windowMinutes === WEEK_MINUTES,
  );
  if (exact) return exact;
  return snapshot.secondary?.windowMinutes === undefined ? snapshot.secondary : undefined;
}

function normalizedUsageKey(value: string | undefined): string | undefined {
  const key = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return key === "" ? undefined : key;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
