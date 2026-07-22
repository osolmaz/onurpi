import {
  type PlanSnapshot,
  samePlanSnapshot,
  type UpdatePlanInput,
  normalizeUpdatePlan,
} from "./plan-schema.ts";

export type PlanStateView = Readonly<{
  revision: number;
  snapshot?: PlanSnapshot;
  sourceTimestamp?: number;
}>;

export type AppliedPlanUpdate = Readonly<{
  explanation?: string;
  snapshot: PlanSnapshot;
}>;

export class PlanState {
  private revision = 0;
  private snapshot: PlanSnapshot | undefined;
  private sourceTimestamp: number | undefined;

  get(): PlanStateView {
    const base = { revision: this.revision };
    if (!this.snapshot) return Object.freeze(base);
    if (this.sourceTimestamp === undefined) {
      return Object.freeze({ ...base, snapshot: this.snapshot });
    }
    return Object.freeze({
      ...base,
      snapshot: this.snapshot,
      sourceTimestamp: this.sourceTimestamp,
    });
  }

  apply(input: UpdatePlanInput, timestamp: number): AppliedPlanUpdate {
    const normalized = normalizeUpdatePlan(input);
    this.replace(normalized.snapshot, timestamp);
    return normalized.explanation
      ? Object.freeze({ explanation: normalized.explanation, snapshot: normalized.snapshot })
      : Object.freeze({ snapshot: normalized.snapshot });
  }

  replace(snapshot: PlanSnapshot | undefined, timestamp?: number): boolean {
    const visibleSnapshot = snapshot && snapshot.plan.length > 0 ? snapshot : undefined;
    const changed = !samePlanSnapshot(this.snapshot, visibleSnapshot);
    this.snapshot = visibleSnapshot;
    this.sourceTimestamp = visibleSnapshot ? timestamp : undefined;
    if (changed) this.revision += 1;
    return changed;
  }

  clear(): boolean {
    return this.replace(undefined);
  }
}
