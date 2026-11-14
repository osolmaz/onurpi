export type QueueSnapshot = {
  readonly followUp: readonly string[];
  readonly steering: readonly string[];
};

export type QueuedSession = {
  clearQueue(): QueueSnapshot;
  followUp(text: string): Promise<unknown>;
  steer(text: string): Promise<unknown>;
};

function dropError(): undefined {
  return undefined;
}

function dropFailure(promise: Promise<unknown>): void {
  void promise.catch(dropError);
}

function requeue(
  session: QueuedSession,
  steering: readonly string[],
  followUp: readonly string[],
): void {
  for (const text of steering) dropFailure(session.steer(text));
  for (const text of followUp) dropFailure(session.followUp(text));
}

/**
 * Remove the oldest queued message and keep the rest in order, steering before follow-ups.
 *
 * Pi has no queue pop, so the queue is drained and rebuilt. Re-queueing a message can expand a
 * prompt template again; a failed re-queue is dropped rather than retried, because the message
 * that the user asked for has already been taken.
 */
export function takeNextQueuedMessage(session: QueuedSession): string | undefined {
  const { followUp, steering } = session.clearQueue();
  const ordered = [...steering, ...followUp];
  const [next, ...rest] = ordered;
  if (next === undefined) return undefined;
  const remainingSteering = Math.max(0, steering.length - 1);
  requeue(session, rest.slice(0, remainingSteering), rest.slice(remainingSteering));
  return next;
}
