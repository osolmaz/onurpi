import { describe, expect, it } from "vitest";
import {
  applyWebSearchSettings,
  extractWebSearchSettings,
  TRACKED_KEYS,
} from "./web-search-config.ts";

describe("extractWebSearchSettings", () => {
  it("keeps reviewed settings and drops unknown keys", () => {
    const live = {
      workflow: "none",
      autoOpenBrowser: false,
      somethingPersonal: "keep out",
    };

    expect(extractWebSearchSettings(live)).toEqual({
      workflow: "none",
      autoOpenBrowser: false,
    });
  });

  it("never copies provider API keys, a proxy URL, or auth settings", () => {
    const live = {
      workflow: "none",
      exaApiKey: "exa-secret",
      geminiApiKey: "gemini-secret",
      brightdataApiKey: "brightdata-secret",
      proxy: "http://user:pass@proxy.example:8080",
      geminiAuth: "adc",
      ssrf: { allowRanges: ["198.18.0.0/15"] },
    };

    const tracked = extractWebSearchSettings(live);

    expect(tracked).toEqual({ workflow: "none" });
    expect(JSON.stringify(tracked)).not.toContain("secret");
    expect(JSON.stringify(tracked)).not.toContain("proxy.example");
  });

  it("returns an empty object for a missing or non-object file", () => {
    expect(extractWebSearchSettings(undefined)).toEqual({});
    expect(extractWebSearchSettings("nope")).toEqual({});
    expect(extractWebSearchSettings(null)).toEqual({});
  });

  it("skips undefined values", () => {
    expect(extractWebSearchSettings({ workflow: undefined })).toEqual({});
  });

  it("has no tracked key that looks like a credential", () => {
    for (const key of TRACKED_KEYS) {
      expect(key).not.toMatch(/(apikey|token|secret|password|credential|auth|proxy)/i);
    }
  });
});

describe("applyWebSearchSettings", () => {
  it("applies tracked settings and preserves live credentials", () => {
    const live = { workflow: "summary-review", exaApiKey: "exa-secret" };
    const tracked = { workflow: "none", autoOpenBrowser: false };

    expect(applyWebSearchSettings(live, tracked)).toEqual({
      workflow: "none",
      autoOpenBrowser: false,
      exaApiKey: "exa-secret",
    });
  });

  it("creates the settings when the live file is absent", () => {
    expect(applyWebSearchSettings(undefined, { workflow: "none" })).toEqual({
      workflow: "none",
    });
  });

  it("ignores keys outside the reviewed list", () => {
    const live = { workflow: "none" };

    expect(applyWebSearchSettings(live, { exaApiKey: "sneaky", unknown: 1 })).toEqual({
      workflow: "none",
    });
  });

  it("rejects a non-object tracked file", () => {
    expect(() => applyWebSearchSettings({}, ["nope"])).toThrow(/Invalid web-search settings/);
  });

  it("rejects a non-object live file", () => {
    expect(() => applyWebSearchSettings(["nope"], {})).toThrow(/No object in/);
  });
});
