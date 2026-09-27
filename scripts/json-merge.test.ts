import { describe, expect, it } from "vitest";
import { differingKeys, isEqual, mergeThreeWay } from "./json-merge.ts";

describe("isEqual", () => {
  it("compares scalars, null, and undefined", () => {
    expect(isEqual("a", "a")).toBe(true);
    expect(isEqual("a", "b")).toBe(false);
    expect(isEqual(null, null)).toBe(true);
    expect(isEqual(null, undefined)).toBe(false);
    expect(isEqual(1, "1")).toBe(false);
  });

  it("ignores object key order but keeps array order", () => {
    expect(isEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isEqual([1, 2], [1, 2])).toBe(true);
    expect(isEqual([1, 2], [2, 1])).toBe(false);
    expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it("rejects mixed types", () => {
    expect(isEqual({ a: 1 }, [1])).toBe(false);
    expect(isEqual("a", ["a"])).toBe(false);
  });
});

describe("differingKeys", () => {
  it("reports only the keys whose values differ, sorted", () => {
    expect(differingKeys({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b"]);
    expect(differingKeys({ z: 1, a: 2 }, {})).toEqual(["a", "z"]);
    expect(differingKeys({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("tolerates documents that are not objects", () => {
    expect(differingKeys(undefined, { a: 1 })).toEqual(["a"]);
    expect(differingKeys({ a: 1 }, "text")).toEqual(["a"]);
    expect(differingKeys(undefined, undefined)).toEqual([]);
  });
});

describe("mergeThreeWay", () => {
  it("takes the value both sides agree on, without a conflict", () => {
    expect(mergeThreeWay({ a: 1 }, { a: 2 }, { a: 2 })).toEqual({ value: { a: 2 }, conflicts: [] });
  });

  it("applies a repository change the machine never saw", () => {
    const base = { defaultModel: "deepseek-ai/DeepSeek-V4.1-Flash:novita" };
    const live = { defaultModel: "deepseek-ai/DeepSeek-V4.1-Flash:novita" };
    const tracked = { defaultModel: "zai-org/GLM-5.3-Flash:baseten" };

    expect(mergeThreeWay(base, live, tracked)).toEqual({
      value: { defaultModel: "zai-org/GLM-5.3-Flash:baseten" },
      conflicts: [],
    });
  });

  it("records a machine change the repository never saw", () => {
    expect(
      mergeThreeWay({ theme: "onur-dark" }, { theme: "onur-light" }, { theme: "onur-dark" }),
    ).toEqual({
      value: { theme: "onur-light" },
      conflicts: [],
    });
  });

  it("merges one-sided changes to different fields of one object", () => {
    const base = { compaction: { reserveTokens: 100, keepRecentTokens: 20000 } };
    const live = { compaction: { reserveTokens: 100, keepRecentTokens: 5000 } };
    const tracked = { compaction: { reserveTokens: 27200, keepRecentTokens: 20000 } };

    expect(mergeThreeWay(base, live, tracked)).toEqual({
      value: { compaction: { reserveTokens: 27200, keepRecentTokens: 5000 } },
      conflicts: [],
    });
  });

  it("reports a leaf that both sides changed differently", () => {
    const base = { compaction: { reserveTokens: 100 } };
    const live = { compaction: { reserveTokens: 200 } };
    const tracked = { compaction: { reserveTokens: 300 } };

    expect(mergeThreeWay(base, live, tracked)).toEqual({
      value: { compaction: {} },
      conflicts: ["$.compaction.reserveTokens"],
    });
  });

  it("reports a whole document that both sides replaced", () => {
    expect(mergeThreeWay(1, 2, 3)).toEqual({ value: undefined, conflicts: ["$"] });
  });

  it("reports a change against a deletion", () => {
    expect(mergeThreeWay({ a: 1 }, {}, { a: 2 })).toEqual({ value: {}, conflicts: ["$.a"] });
  });

  it("applies a deletion that only one side made", () => {
    expect(mergeThreeWay({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 })).toEqual({
      value: { a: 1 },
      conflicts: [],
    });
    expect(mergeThreeWay({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 })).toEqual({
      value: { a: 1 },
      conflicts: [],
    });
  });

  it("merges keys that both sides added", () => {
    expect(mergeThreeWay({}, { a: 1 }, { b: 2 })).toEqual({ value: { a: 1, b: 2 }, conflicts: [] });
  });

  it("keeps the order of the live document", () => {
    const merged = mergeThreeWay({}, { z: 1, a: 2 }, {});
    expect(Object.keys(merged.value as Record<string, unknown>)).toEqual(["z", "a"]);
  });

  it("resolves conflicts to the live value when asked", () => {
    expect(mergeThreeWay({ a: 1 }, { a: 2 }, { a: 3 }, { onConflict: "live" })).toEqual({
      value: { a: 2 },
      conflicts: [],
    });
  });

  it("merges fields of an object that both sides replaced from a scalar", () => {
    expect(mergeThreeWay(5, { a: 1 }, { b: 2 })).toEqual({ value: { a: 1, b: 2 }, conflicts: [] });
  });

  it("reports every conflict it finds", () => {
    expect(mergeThreeWay({ a: 1, b: 1, c: 1 }, { a: 2, b: 2, c: 2 }, { a: 3, b: 3, c: 3 })).toEqual(
      {
        value: {},
        conflicts: ["$.a", "$.b", "$.c"],
      },
    );
  });
});
