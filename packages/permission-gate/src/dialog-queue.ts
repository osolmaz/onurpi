/**
 * Run dialogs one at a time. A script can start several tool calls at once, and two dialogs that
 * overlap would let a key meant for the first one answer the second.
 */
export type DialogQueue = {
  run<T>(task: () => Promise<T>): Promise<T>;
};

export function createDialogQueue(): DialogQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
