import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  installReplayProjection,
  newestCompactionEntryId,
  projectedReplayEntries,
  replayProjectionMethod,
  supportsReplayProjection,
} from "./replay-projection.ts";

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type BranchEntry = BranchEntries[number];

function messageEntry(id: string): BranchEntry {
  return { id, parentId: null, timestamp: "t", type: "message" } as unknown as BranchEntry;
}

function entries(...ids: string[]): BranchEntries {
  return ids.map(messageEntry);
}

function compaction(id: string): BranchEntry {
  return { id, parentId: null, timestamp: "t", type: "compaction" } as unknown as BranchEntry;
}

describe("Turn Fold replay projection selection", () => {
  it("keeps projected replay entries and drops hidden ones", () => {
    const given = entries("u1", "hidden", "u2");
    const selected = projectedReplayEntries(given, entries("u2"), []);
    expect(selected).toEqual([{ id: "u2", parentId: null, timestamp: "t", type: "message" }]);
  });

  it("adds projected entries Pi did not offer in front of the given entries", () => {
    const given = entries("u2");
    const branch = [...entries("u0"), compaction("c1"), ...entries("u2")];
    const selected = projectedReplayEntries(given, entries("u0", "u2"), branch);
    expect(selected.map((entry) => entry.id)).toEqual(["u0", "u2"]);
  });

  it("does not repeat the newest compaction entry Pi renders itself", () => {
    const branch = [...entries("u0"), compaction("c1"), ...entries("u2"), compaction("c2")];
    const given = entries("u2");
    const display = [compaction("c2"), ...entries("u0", "u2")];
    const selected = projectedReplayEntries(given, display, branch);
    expect(selected.map((entry) => entry.id)).toEqual(["u0", "u2"]);
  });

  it("keeps the newest compaction entry when Pi offers it", () => {
    const branch = [compaction("c2"), ...entries("u2")];
    const given = [compaction("c2"), ...entries("u2")];
    const selected = projectedReplayEntries(given, given, branch);
    expect(selected.map((entry) => entry.id)).toEqual(["c2", "u2"]);
  });

  it("passes unknown replay entries through and leaves the list alone without a projection", () => {
    const anonymous = { type: "custom" } as unknown as BranchEntry;
    expect(projectedReplayEntries([anonymous], entries("u1"), [])).toEqual([
      { id: "u1", parentId: null, timestamp: "t", type: "message" },
      anonymous,
    ]);
    expect(projectedReplayEntries(entries("u1"), [], [])).toEqual(entries("u1"));
  });

  it("finds the newest compaction entry of a branch", () => {
    expect(newestCompactionEntryId([compaction("c1"), ...entries("u1")])).toBe("c1");
    expect(newestCompactionEntryId(entries("u1"))).toBeUndefined();
  });
});

describe("Turn Fold replay projection installation", () => {
  function fakeTarget(): { calls: unknown[][]; target: object } {
    const calls: unknown[][] = [];
    const target = {
      renderSessionEntries(this: unknown, ...args: unknown[]): string {
        calls.push([this, ...args]);
        return "original";
      },
    };
    return { calls, target };
  }

  const addedEntry = { id: "added" } as unknown as BranchEntry;
  const givenEntry = { id: "u1" } as unknown as BranchEntry;

  it("reports whether Pi exposes the replay entry point", () => {
    expect(supportsReplayProjection(fakeTarget().target)).toBe(true);
    expect(supportsReplayProjection({})).toBe(false);
  });

  it("wraps the replay method, forwards the selection, and restores it exactly", () => {
    const { calls, target } = fakeTarget();
    const original = replayProjectionMethod(target);
    const context = { marker: true };
    const restore = installReplayProjection(
      () => (given) => [...given, addedEntry],
      () => undefined,
      target,
    );

    const result = Reflect.apply(
      replayProjectionMethod(target) as (...rest: unknown[]) => unknown,
      context,
      [[givenEntry], { updateFooter: true }],
    );

    expect(result).toBe("original");
    expect(calls).toEqual([[context, [givenEntry, addedEntry], { updateFooter: true }]]);
    restore();
    expect(replayProjectionMethod(target)).toBe(original);
  });

  it("replays Pi's own entries when the projection fails", () => {
    const { calls, target } = fakeTarget();
    const onError = vi.fn();
    const given = entries("u1");
    const restore = installReplayProjection(
      () => () => {
        throw new Error("projection failed");
      },
      onError,
      target,
    );

    expect(Reflect.apply(replayProjectionMethod(target) as () => string, {}, [given])).toBe(
      "original",
    );
    expect(calls.at(-1)?.[1]).toBe(given);
    expect(onError).toHaveBeenCalledTimes(1);

    Reflect.apply(replayProjectionMethod(target) as () => string, {}, [given]);
    expect(onError).toHaveBeenCalledTimes(1);
    restore();
  });

  it("leaves the replay method alone when a projection is not installed", () => {
    const { calls, target } = fakeTarget();
    const restore = installReplayProjection(
      () => undefined,
      () => undefined,
      target,
    );

    Reflect.apply(replayProjectionMethod(target) as () => string, {}, [entries("u1")]);
    expect(calls.at(-1)?.[1]).toEqual(entries("u1"));
    restore();
  });

  it("keeps one wrapper per target and uses the newest projection", () => {
    const { calls, target } = fakeTarget();
    const original = replayProjectionMethod(target);
    const first = installReplayProjection(
      () => (given) => [...given, addedEntry],
      () => undefined,
      target,
    );
    const wrapper = replayProjectionMethod(target);
    const second = installReplayProjection(
      () => (given) => given.filter((entry) => entry.id !== "hidden"),
      () => undefined,
      target,
    );

    expect(replayProjectionMethod(target)).toBe(wrapper);
    Reflect.apply(replayProjectionMethod(target) as () => string, {}, [
      [...entries("hidden"), givenEntry],
    ]);
    expect(calls.at(-1)?.[1]).toEqual([givenEntry]);

    second();
    expect(replayProjectionMethod(target)).toBe(wrapper);
    first();
    expect(replayProjectionMethod(target)).toBe(original);

    Reflect.apply(replayProjectionMethod(target) as () => string, {}, [entries("hidden")]);
    expect(calls.at(-1)?.[1]).toEqual(entries("hidden"));
  });

  it("wraps again when the target method changed outside the installation", () => {
    const { calls, target } = fakeTarget();
    const first = installReplayProjection(
      () => (given) => [...given, addedEntry],
      () => undefined,
      target,
    );
    const replacement = function (this: unknown, ...args: unknown[]): string {
      calls.push([this, ...args]);
      return "replaced";
    };
    Reflect.set(target, "renderSessionEntries", replacement);

    const second = installReplayProjection(
      () => (given) => given.filter((entry) => entry.id !== "hidden"),
      () => undefined,
      target,
    );

    expect(replayProjectionMethod(target)).not.toBe(replacement);
    Reflect.apply(replayProjectionMethod(target) as () => string, {}, [
      [...entries("hidden"), givenEntry],
    ]);
    expect(calls.at(-1)?.[1]).toEqual([givenEntry]);

    second();
    expect(replayProjectionMethod(target)).toBe(replacement);
    first();
    expect(replayProjectionMethod(target)).toBe(replacement);
  });

  it("rejects a target without the replay entry point", () => {
    expect(() =>
      installReplayProjection(
        () => undefined,
        () => undefined,
        {},
      ),
    ).toThrow("Pi does not expose the transcript replay entry point");
  });
});
