import { createRunObservation, type RunObservation } from "./run-outcome.ts";
import { tokenDeltaFromUsage } from "./usage.ts";

export class GoalEpisode {
  readonly goalId: string;
  readonly startedAt: number;
  private readonly messages: unknown[] = [];
  private tokenDelta = 0;

  constructor(goalId: string, startedAt = Date.now()) {
    this.goalId = goalId;
    this.startedAt = startedAt;
  }

  accountTurn(usage: unknown): void {
    this.tokenDelta += tokenDeltaFromUsage(usage);
  }

  addMessages(messages: readonly unknown[]): void {
    this.messages.push(...messages);
  }

  observation(endedAt = Date.now()): RunObservation {
    const elapsedSeconds = Math.max(0, Math.round((endedAt - this.startedAt) / 1000));
    return createRunObservation(this.messages, this.tokenDelta, elapsedSeconds);
  }
}
