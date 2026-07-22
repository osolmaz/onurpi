import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const UPDATE_PLAN_TOOL_NAME = "update_plan";
export const MAX_PLAN_STEPS = 64;
export const MAX_STEP_LENGTH = 500;
export const MAX_EXPLANATION_LENGTH = 2_000;

export const PLAN_STATUSES = ["pending", "in_progress", "completed"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanStep = Readonly<{
  status: PlanStatus;
  step: string;
}>;
export type PlanSnapshot = Readonly<{
  plan: readonly PlanStep[];
}>;
export type NormalizedPlanUpdate = Readonly<{
  explanation?: string;
  snapshot: PlanSnapshot;
}>;

const PlanStepParameters = Type.Object(
  {
    step: Type.String({ minLength: 1, maxLength: MAX_STEP_LENGTH }),
    status: StringEnum(PLAN_STATUSES),
  },
  { additionalProperties: false },
);

export const UpdatePlanParameters = Type.Object(
  {
    explanation: Type.Optional(Type.String({ maxLength: MAX_EXPLANATION_LENGTH })),
    plan: Type.Array(PlanStepParameters, { maxItems: MAX_PLAN_STEPS }),
  },
  { additionalProperties: false },
);

export type UpdatePlanInput = Static<typeof UpdatePlanParameters>;

type UnknownRecord = Record<string, unknown>;
type DecodedExplanation = Readonly<{ valid: boolean; value?: string }>;

const SNAPSHOT_KEYS = new Set(["plan"]);
const UPDATE_KEYS = new Set(["explanation", "plan"]);
const STEP_KEYS = new Set(["status", "step"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && PLAN_STATUSES.some((status) => status === value);
}

function freezeSnapshot(plan: readonly PlanStep[]): PlanSnapshot {
  return Object.freeze({ plan: Object.freeze([...plan]) });
}

function normalizedStep(item: { status: PlanStatus; step: string }, index: number): PlanStep {
  const step = item.step.trim();
  if (step.length === 0) throw new Error(`Plan step ${String(index + 1)} must not be blank`);
  if (step.length > MAX_STEP_LENGTH) {
    throw new Error(
      `Plan step ${String(index + 1)} may contain at most ${String(MAX_STEP_LENGTH)} characters`,
    );
  }
  return Object.freeze({ status: item.status, step });
}

function normalizeSteps(steps: readonly { status: PlanStatus; step: string }[]): PlanSnapshot {
  if (steps.length > MAX_PLAN_STEPS) {
    throw new Error(`Plan may contain at most ${String(MAX_PLAN_STEPS)} steps`);
  }

  const plan = steps.map(normalizedStep);
  const activeCount = plan.filter((item) => item.status === "in_progress").length;
  if (activeCount > 1) throw new Error("Plan may contain at most one in_progress step");
  return freezeSnapshot(plan);
}

export function normalizeUpdatePlan(input: UpdatePlanInput): NormalizedPlanUpdate {
  const explanation = input.explanation?.trim();
  if (explanation !== undefined && explanation.length > MAX_EXPLANATION_LENGTH) {
    throw new Error(
      `Plan explanation may contain at most ${String(MAX_EXPLANATION_LENGTH)} characters`,
    );
  }

  const snapshot = normalizeSteps(input.plan);
  return explanation ? Object.freeze({ explanation, snapshot }) : Object.freeze({ snapshot });
}

function decodeStepText(value: unknown, requireCanonicalText: boolean): string | undefined {
  if (typeof value !== "string") return undefined;
  const step = value.trim();
  if (step.length === 0 || step.length > MAX_STEP_LENGTH) return undefined;
  if (requireCanonicalText && value !== step) return undefined;
  return step;
}

function decodeStep(value: unknown, requireCanonicalText: boolean): PlanStep | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, STEP_KEYS)) return undefined;
  const status = value["status"];
  const step = decodeStepText(value["step"], requireCanonicalText);
  if (!isPlanStatus(status) || step === undefined) return undefined;
  return Object.freeze({ status, step });
}

function decodeSteps(value: unknown, requireCanonicalText: boolean): PlanSnapshot | undefined {
  if (!Array.isArray(value) || value.length > MAX_PLAN_STEPS) return undefined;
  const steps: PlanStep[] = [];
  for (const item of value) {
    const step = decodeStep(item, requireCanonicalText);
    if (!step) return undefined;
    steps.push(step);
  }
  try {
    return normalizeSteps(steps);
  } catch {
    return undefined;
  }
}

function decodeExplanation(value: unknown): DecodedExplanation {
  if (value === undefined) return Object.freeze({ valid: true });
  if (typeof value !== "string" || value.length > MAX_EXPLANATION_LENGTH) {
    return Object.freeze({ valid: false });
  }
  const explanation = value.trim();
  return explanation
    ? Object.freeze({ valid: true, value: explanation })
    : Object.freeze({ valid: true });
}

export function decodePlanSnapshot(value: unknown): PlanSnapshot | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS)) return undefined;
  return decodeSteps(value["plan"], true);
}

export function decodeUpdatePlanInput(value: unknown): NormalizedPlanUpdate | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, UPDATE_KEYS)) return undefined;
  const explanation = decodeExplanation(value["explanation"]);
  if (!explanation.valid) return undefined;
  const snapshot = decodeSteps(value["plan"], false);
  if (!snapshot) return undefined;
  return explanation.value
    ? Object.freeze({ explanation: explanation.value, snapshot })
    : Object.freeze({ snapshot });
}

export function samePlanSnapshot(
  left: PlanSnapshot | undefined,
  right: PlanSnapshot | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.plan.length !== right.plan.length) return false;
  return left.plan.every((step, index) => {
    const other = right.plan[index];
    return other?.status === step.status && other.step === step.step;
  });
}

export function completedPlanSteps(snapshot: PlanSnapshot): number {
  return snapshot.plan.reduce((count, step) => count + (step.status === "completed" ? 1 : 0), 0);
}
