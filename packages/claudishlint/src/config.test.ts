import { describe, expect, it } from "vitest";

import { configPath, parseConfig } from "./config.ts";

const SOURCE = ".claudishlint.json";

describe("parseConfig", () => {
  it("accepts an empty object", () => {
    expect(parseConfig({}, SOURCE)).toEqual({});
  });

  it("reads a strictness inside the range", () => {
    expect(parseConfig({ strictness: 0.8 }, SOURCE)).toEqual({ strictness: 0.8 });
  });

  it("reads per-rule overrides", () => {
    expect(parseConfig({ rules: { "ai-vocab": 0, "colon-triple": 1 } }, SOURCE)).toEqual({
      rules: { "ai-vocab": 0, "colon-triple": 1 },
    });
  });

  it("rejects a value that is not an object", () => {
    for (const value of [null, 3, "strictness", []]) {
      expect(() => parseConfig(value, SOURCE)).toThrow(/must hold a JSON object/);
    }
  });

  it("rejects an unknown key", () => {
    expect(() => parseConfig({ stricness: 0.5 }, SOURCE)).toThrow(/unknown key "stricness"/);
  });

  it("rejects a strictness outside the range or of the wrong type", () => {
    for (const strictness of [-0.1, 1.5, false, "0.5", null, Number.NaN]) {
      expect(() => parseConfig({ strictness }, SOURCE)).toThrow(/needs a strictness from 0 to 1/);
    }
  });

  it("rejects rules that are not an object", () => {
    expect(() => parseConfig({ rules: [] }, SOURCE)).toThrow(/needs rules as an object/);
  });

  it("rejects an unknown rule id", () => {
    expect(() => parseConfig({ rules: { "no-chian": 1 } }, SOURCE)).toThrow(
      /unknown rule id "no-chian"/,
    );
  });

  it("rejects a rule override other than 0 or 1", () => {
    for (const override of [true, 0.5, "1", null]) {
      expect(() => parseConfig({ rules: { "no-chain": override } }, SOURCE)).toThrow(
        /rules\["no-chain"\] to be 0 or 1/,
      );
    }
  });
});

describe("configPath", () => {
  it("names the config file inside the agent directory", () => {
    expect(configPath("/tmp/agent")).toBe("/tmp/agent/.claudishlint.json");
  });
});
