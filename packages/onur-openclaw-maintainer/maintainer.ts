export const WORKFLOW_START_CHANNEL = "pi-workflows:start";
export const WORKFLOW_START_RESULT_CHANNEL = "pi-workflows:start-result";
export const OPENCLAW_REPOSITORY = "openclaw/openclaw";
export const INVENTORY_URL =
  "https://raw.githubusercontent.com/osolmaz/onurclaw/main/OPENCLAW_ONUR_INVENTORY.json";
export const WORKFLOW_START_TIMEOUT_MS = 10_000;

const MAX_INVENTORY_BYTES = 2_000_000;
const MAX_PICKER_ISSUES = 100;

export type MaintainerIssue = {
  activity: number;
  area: string;
  number: number;
  title: string;
  url: string;
};

export type MaintainerWorkflowInput = {
  allowCommits: false;
  allowGitHubWrites: false;
  allowMerge: false;
  allowTrackedChanges: false;
  issueNumber: number;
  issueUrl: string;
  operatorNote: string;
  repository: typeof OPENCLAW_REPOSITORY;
  workflowTest: true;
};

export type WorkflowStartRequest = {
  requestId: string;
  ref: string;
  input: unknown;
};

export type WorkflowStartResult =
  | { requestId: string; ok: true; workflowName: string }
  | { requestId: string; ok: false; error: string };

export type SharedEventBus = {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
};

export function parseIssueReference(value: string): MaintainerIssue | undefined {
  const trimmed = value.trim();
  const numeric = /^#?(\d+)$/.exec(trimmed)?.[1];
  const urlMatch = /^https:\/\/github\.com\/openclaw\/openclaw\/issues\/(\d+)\/?$/.exec(
    trimmed,
  )?.[1];
  const number = parseIssueNumber(numeric ?? urlMatch);
  if (number === undefined) return undefined;
  return {
    activity: 0,
    area: "Selected issue",
    number,
    title: `OpenClaw issue #${String(number)}`,
    url: issueUrl(number),
  };
}

export function buildWorkflowInput(issue: MaintainerIssue): MaintainerWorkflowInput {
  return {
    allowCommits: false,
    allowGitHubWrites: false,
    allowMerge: false,
    allowTrackedChanges: false,
    issueNumber: issue.number,
    issueUrl: issue.url,
    operatorNote: "This is a workflow test. Do not merge automatically.",
    repository: OPENCLAW_REPOSITORY,
    workflowTest: true,
  };
}

export function parseInventory(value: unknown): MaintainerIssue[] {
  if (!isRecord(value) || !Array.isArray(value["open_threads"])) {
    throw new Error("The OpenClaw inventory is missing open_threads");
  }
  const issues = value["open_threads"]
    .map(parseInventoryIssue)
    .filter((issue): issue is MaintainerIssue => issue !== undefined)
    .sort((left, right) => right.activity - left.activity || right.number - left.number);
  if (issues.length === 0) throw new Error("The OpenClaw inventory has no open issues");
  return issues.slice(0, MAX_PICKER_ISSUES);
}

export async function fetchInventory(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MaintainerIssue[]> {
  const response = await fetcher(INVENTORY_URL, {
    headers: { accept: "application/json", "user-agent": "onur-openclaw-maintainer" },
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    throw new Error(`Inventory request failed with HTTP ${String(response.status)}`);
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAX_INVENTORY_BYTES) {
    throw new Error("The OpenClaw inventory response is too large");
  }
  const body = await response.text();
  if (body.length > MAX_INVENTORY_BYTES) throw new Error("The OpenClaw inventory is too large");
  return parseInventory(JSON.parse(body) as unknown);
}

export function formatIssueChoice(issue: MaintainerIssue): string {
  return `#${String(issue.number)} · ${issue.area} · ${issue.title}`;
}

export async function requestWorkflowStart(options: {
  bus: SharedEventBus;
  input: MaintainerWorkflowInput;
  ref: string;
  requestId: string;
  timeoutMs?: number;
}): Promise<WorkflowStartResult> {
  const { bus, input, ref, requestId } = options;
  return await new Promise<WorkflowStartResult>((resolve) => {
    let settled = false;
    const finish = (result: WorkflowStartResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      resolve(result);
    };
    const stop = bus.on(WORKFLOW_START_RESULT_CHANNEL, (value) => {
      const result = parseWorkflowStartResult(value);
      if (result?.requestId !== requestId) return;
      finish(result);
    });
    const timer = setTimeout(() => {
      finish({
        requestId,
        ok: false,
        error:
          "Timed out waiting for pi-workflows. Confirm that pi-workflows is installed and loaded.",
      });
    }, options.timeoutMs ?? WORKFLOW_START_TIMEOUT_MS);
    timer.unref();
    const request: WorkflowStartRequest = { requestId, ref, input };
    bus.emit(WORKFLOW_START_CHANNEL, request);
  });
}

export function isForbiddenMaintainerCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  return FORBIDDEN_COMMANDS.some((pattern) => pattern.test(normalized));
}

function parseInventoryIssue(value: unknown): MaintainerIssue | undefined {
  if (!isRecord(value) || value["type"] !== "issue") return undefined;
  const number = parseIssueNumber(value["number"]);
  const activity = nonNegativeInteger(value["activity"]);
  const area = boundedString(value["area"], 200);
  const title = boundedString(value["title"], 1_000);
  if (
    number === undefined ||
    activity === undefined ||
    area === undefined ||
    title === undefined ||
    value["url"] !== issueUrl(number)
  ) {
    return undefined;
  }
  return { activity, area, number, title, url: issueUrl(number) };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function parseIssueNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
}

function issueUrl(number: number): string {
  return `https://github.com/${OPENCLAW_REPOSITORY}/issues/${String(number)}`;
}

function parseWorkflowStartResult(value: unknown): WorkflowStartResult | undefined {
  if (
    !isRecord(value) ||
    typeof value["requestId"] !== "string" ||
    typeof value["ok"] !== "boolean"
  ) {
    return undefined;
  }
  if (value["ok"] && typeof value["workflowName"] === "string") {
    return { requestId: value["requestId"], ok: true, workflowName: value["workflowName"] };
  }
  if (!value["ok"] && typeof value["error"] === "string") {
    return { requestId: value["requestId"], ok: false, error: value["error"] };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const FORBIDDEN_COMMANDS = [
  /(?:^|[;&|]\s*)git (?:commit|push|merge|rebase|cherry-pick|am)(?:\s|$)/,
  /(?:^|[;&|]\s*)gh issue (?:close|comment|create|delete|edit|pin|reopen|transfer|unpin)(?:\s|$)/,
  /(?:^|[;&|]\s*)gh pr (?:close|comment|create|edit|merge|ready|reopen|review)(?:\s|$)/,
  /(?:^|[;&|]\s*)gh api .* (?:-x|--method) (?:delete|patch|post|put)(?:\s|$)/,
  /(?:^|[;&|]\s*)gh api .* (?:--input|-f|--field|-f|--raw-field)(?:\s|$)/,
] as const;
