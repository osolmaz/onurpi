import { describe, expect, it } from "vitest";
import {
  adoptTracked,
  applySettingsChanges,
  LOCAL_ONLY_KEYS,
  stripLocalOnly,
} from "./settings-file.ts";

describe("stripLocalOnly", () => {
  it("drops machine-local keys and keeps the rest in order", () => {
    const stripped = stripLocalOnly({
      defaultModel: "zai-org/GLM-5.3-Flash:baseten",
      lastChangelogVersion: "0.87.1",
      theme: "onur-dark",
    });

    expect(stripped).toEqual({
      defaultModel: "zai-org/GLM-5.3-Flash:baseten",
      theme: "onur-dark",
    });
    expect(Object.keys(stripped)).toEqual(["defaultModel", "theme"]);
  });

  it("does not mutate the document it reads", () => {
    const live = { lastChangelogVersion: "0.87.1" };
    stripLocalOnly(live);
    expect(live).toEqual({ lastChangelogVersion: "0.87.1" });
  });

  it("lists the keys that never travel", () => {
    expect(LOCAL_ONLY_KEYS).toContain("lastChangelogVersion");
  });
});

describe("applySettingsChanges", () => {
  it("writes a value the merge changed", () => {
    const applied = applySettingsChanges(
      { defaultModel: "deepseek" },
      { defaultModel: "deepseek" },
      { defaultModel: "glm" },
    );

    expect(applied).toEqual({ defaultModel: "glm" });
  });

  it("keeps a live value that only differs from the repository view", () => {
    const worktree = "../../repos/onurpi-worktrees/dev/packages/theme";
    const applied = applySettingsChanges(
      { packages: [worktree], defaultModel: "deepseek" },
      { packages: ["../../repos/onurpi/packages/theme"], defaultModel: "deepseek" },
      { packages: ["../../repos/onurpi/packages/theme"], defaultModel: "glm" },
    );

    expect(applied).toEqual({ packages: [worktree], defaultModel: "glm" });
  });

  it("drops a reviewed key that the repository removed", () => {
    const applied = applySettingsChanges(
      { defaultModel: "glm", retired: true },
      { defaultModel: "glm", retired: true },
      { defaultModel: "glm" },
    );

    expect(applied).toEqual({ defaultModel: "glm" });
    expect("retired" in applied).toBe(false);
  });

  it("keeps machine-local keys and the live key order", () => {
    const applied = applySettingsChanges(
      { lastChangelogVersion: "0.87.1", theme: "onur-dark" },
      { theme: "onur-dark" },
      { theme: "onur-dark", defaultModel: "glm" },
    );

    expect(Object.keys(applied)).toEqual(["lastChangelogVersion", "theme", "defaultModel"]);
    expect(applied["lastChangelogVersion"]).toBe("0.87.1");
  });

  it("leaves the live document untouched when the merge changed nothing", () => {
    const live = { lastChangelogVersion: "0.87.1", theme: "onur-dark" };
    expect(applySettingsChanges(live, { theme: "onur-dark" }, { theme: "onur-dark" })).toEqual(
      live,
    );
  });
});

describe("adoptTracked", () => {
  it("takes every repository key and keeps machine-local keys", () => {
    const adopted = adoptTracked(
      { defaultModel: "glm", packages: ["../../repos/onurpi/packages/theme"] },
      {
        defaultModel: "deepseek",
        lastChangelogVersion: "0.87.1",
        experiment: true,
      },
    );

    expect(adopted).toEqual({
      defaultModel: "glm",
      lastChangelogVersion: "0.87.1",
      packages: ["../../repos/onurpi/packages/theme"],
    });
    expect("experiment" in adopted).toBe(false);
  });

  it("keeps a live key in place and appends the repository-only keys", () => {
    const adopted = adoptTracked(
      { theme: "onur-dark", tuiMode: "fullscreen" },
      {
        lastChangelogVersion: "0.87.1",
        theme: "onur-dark",
      },
    );

    expect(Object.keys(adopted)).toEqual(["lastChangelogVersion", "theme", "tuiMode"]);
  });
});
