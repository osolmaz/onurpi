import { describe, expect, test } from "vitest";
import { applyContextFloor, type CatalogModel } from "./hf-context-floor.ts";

const FLOOR = 272_000;

describe("applyContextFloor", () => {
  test("raises catalog models below the floor", () => {
    const catalog: CatalogModel[] = [
      { id: "org/small", contextWindow: 131_072 },
      { id: "org/small:routed", contextWindow: 40_960 },
    ];
    expect(applyContextFloor({}, catalog, FLOOR)).toEqual({
      "org/small": { contextWindow: FLOOR },
      "org/small:routed": { contextWindow: FLOOR },
    });
  });

  test("never lowers catalog windows at or above the floor", () => {
    const catalog: CatalogModel[] = [
      { id: "org/exact", contextWindow: FLOOR },
      { id: "org/big", contextWindow: 1_048_576 },
    ];
    expect(applyContextFloor({}, catalog, FLOOR)).toEqual({});
  });

  test("removes pure floor artifacts from models at or above the floor", () => {
    const catalog: CatalogModel[] = [
      { id: "org/big", contextWindow: 1_048_576 },
      { id: "org/manual", contextWindow: 1_048_576 },
    ];
    const existing = {
      "org/big": { contextWindow: FLOOR },
      "org/manual": { contextWindow: 400_000 },
    };
    expect(applyContextFloor(existing, catalog, FLOOR)).toEqual({
      "org/manual": { contextWindow: 400_000 },
    });
  });

  test("skips models without a window", () => {
    const catalog: CatalogModel[] = [{ id: "org/unknown" }];
    expect(applyContextFloor({}, catalog, FLOOR)).toEqual({});
  });

  test("raises existing below-floor entries and preserves stale ones", () => {
    const catalog: CatalogModel[] = [{ id: "org/small", contextWindow: 131_072 }];
    const existing = {
      "org/small": { contextWindow: 100_000 },
      "org/retired": { contextWindow: FLOOR },
    };
    expect(applyContextFloor(existing, catalog, FLOOR)).toEqual({
      "org/small": { contextWindow: FLOOR },
      "org/retired": { contextWindow: FLOOR },
    });
  });

  test("leaves existing entries at or above the floor alone", () => {
    const catalog: CatalogModel[] = [{ id: "org/small", contextWindow: 131_072 }];
    const existing = { "org/small": { contextWindow: 300_000 } };
    expect(applyContextFloor(existing, catalog, FLOOR)).toEqual(existing);
  });

  test("keeps extra fields on raised entries", () => {
    const catalog: CatalogModel[] = [{ id: "org/small", contextWindow: 131_072 }];
    const existing = { "org/small": { contextWindow: 131_072, cost: { input: 0 } } };
    expect(applyContextFloor(existing, catalog, FLOOR)).toEqual({
      "org/small": { contextWindow: FLOOR, cost: { input: 0 } },
    });
  });
});
