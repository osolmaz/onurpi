import { describe, expect, it, vi } from "vitest";

import {
  applyStartupModel,
  registerStartupModel,
  STARTUP_MODEL,
  startupModelError,
  type SessionStartReason,
  type StartupModelSession,
} from "./startup-model.ts";

type FakeModel = {
  provider: string;
  id: string;
  label: string;
};

type StartHandler = (
  reason: SessionStartReason,
  session: StartupModelSession<FakeModel>,
) => Promise<void>;

const targetModel: FakeModel = { ...STARTUP_MODEL, label: "Sol" };
const otherModel: FakeModel = { provider: "anthropic", id: "claude-opus-4-7", label: "Opus" };

function createOptions(
  overrides: {
    reason?: SessionStartReason;
    activeModel?: FakeModel;
    foundModel?: FakeModel;
    modelAvailable?: boolean;
    setResult?: boolean;
  } = {},
) {
  const findModel = vi.fn<() => FakeModel | undefined>(() =>
    overrides.modelAvailable === false ? undefined : (overrides.foundModel ?? targetModel),
  );
  const setModel = vi.fn(() => Promise.resolve(overrides.setResult ?? true));
  return {
    options: {
      reason: overrides.reason ?? "startup",
      activeModel: overrides.activeModel ?? otherModel,
      target: STARTUP_MODEL,
      findModel,
      setModel,
    },
    findModel,
    setModel,
  };
}

describe("applyStartupModel", () => {
  it("selects the configured model at process startup", async () => {
    const { options, findModel, setModel } = createOptions();

    await expect(applyStartupModel(options)).resolves.toBe("selected");
    expect(findModel).toHaveBeenCalledWith("openai-codex", "gpt-5.6-sol");
    expect(setModel).toHaveBeenCalledWith(targetModel);
  });

  it("does nothing when the configured model is already active", async () => {
    const { options, findModel, setModel } = createOptions({ activeModel: targetModel });

    await expect(applyStartupModel(options)).resolves.toBe("already-active");
    expect(findModel).not.toHaveBeenCalled();
    expect(setModel).not.toHaveBeenCalled();
  });

  it.each<SessionStartReason>(["reload", "new", "resume", "fork"])(
    "keeps the active model after a %s event",
    async (reason) => {
      const { options, findModel, setModel } = createOptions({ reason });

      await expect(applyStartupModel(options)).resolves.toBe("ignored");
      expect(findModel).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();
    },
  );

  it("reports an unavailable configured model", async () => {
    const { options, setModel } = createOptions({ modelAvailable: false });

    await expect(applyStartupModel(options)).resolves.toBe("missing");
    expect(setModel).not.toHaveBeenCalled();
  });

  it("reports missing authentication without changing the model", async () => {
    const { options, setModel } = createOptions({ setResult: false });

    await expect(applyStartupModel(options)).resolves.toBe("unauthorized");
    expect(setModel).toHaveBeenCalledOnce();
  });
});

describe("registerStartupModel", () => {
  it("wires startup handling and reports actionable errors", async () => {
    let startHandler: StartHandler | undefined;
    const setModel = vi.fn(() => Promise.resolve(false));
    registerStartupModel<FakeModel>({
      onSessionStart: (handler) => {
        startHandler = handler;
      },
      setModel,
    });
    const notifyError = vi.fn();

    expect(startHandler).toBeDefined();
    await startHandler?.("startup", {
      activeModel: otherModel,
      findModel: () => targetModel,
      notifyError,
    });

    expect(notifyError).toHaveBeenCalledWith(
      "Startup model openai-codex/gpt-5.6-sol has no configured authentication",
    );
  });
});

describe("startupModelError", () => {
  it("formats only failures", () => {
    expect(startupModelError("missing", STARTUP_MODEL)).toBe(
      "Startup model openai-codex/gpt-5.6-sol is unavailable",
    );
    expect(startupModelError("unauthorized", STARTUP_MODEL)).toBe(
      "Startup model openai-codex/gpt-5.6-sol has no configured authentication",
    );
    expect(startupModelError("ignored", STARTUP_MODEL)).toBeUndefined();
    expect(startupModelError("already-active", STARTUP_MODEL)).toBeUndefined();
    expect(startupModelError("selected", STARTUP_MODEL)).toBeUndefined();
  });
});
