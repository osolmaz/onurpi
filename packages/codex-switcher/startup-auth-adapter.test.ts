import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { installStartupAuthAdapter } from "./startup-auth-adapter.ts";

type RuntimePrototype = {
  hasConfiguredAuth: (providerId: string) => boolean;
};

function prototypeWith(result: boolean): {
  readonly original: RuntimePrototype["hasConfiguredAuth"];
  readonly prototype: RuntimePrototype;
} {
  const original = vi.fn((providerId: string) => {
    void providerId;
    return result;
  });
  return { original, prototype: { hasConfiguredAuth: original } };
}

describe("startup auth adapter", () => {
  it("recognizes provider-owned Codex authentication only during startup", () => {
    const test = prototypeWith(false);
    const restore = installStartupAuthAdapter({
      isReady: () => true,
      piVersion: "0.84.2",
      runtimePrototype: test.prototype,
    });

    expect(test.prototype.hasConfiguredAuth("openai-codex")).toBe(true);
    expect(test.prototype.hasConfiguredAuth("other-provider")).toBe(false);
    expect(test.original).toHaveBeenCalledExactlyOnceWith("other-provider");

    restore();
    expect(test.prototype.hasConfiguredAuth).toBe(test.original);
    expect(test.prototype.hasConfiguredAuth("openai-codex")).toBe(false);
  });

  it("reports Codex readiness checks after evaluating provider-owned state", () => {
    const test = prototypeWith(false);
    const onCheck = vi.fn();
    const restore = installStartupAuthAdapter({
      isReady: () => true,
      onCheck,
      piVersion: "0.84.2",
      runtimePrototype: test.prototype,
    });

    expect(test.prototype.hasConfiguredAuth("other-provider")).toBe(false);
    expect(onCheck).not.toHaveBeenCalled();
    expect(test.prototype.hasConfiguredAuth("openai-codex")).toBe(true);
    expect(onCheck).toHaveBeenCalledOnce();
    restore();
  });

  it("delegates missing and invalid provider-owned state", () => {
    const missing = prototypeWith(false);
    const restoreMissing = installStartupAuthAdapter({
      isReady: () => false,
      piVersion: "0.84.99",
      runtimePrototype: missing.prototype,
    });
    expect(missing.prototype.hasConfiguredAuth("openai-codex")).toBe(false);
    expect(missing.original).toHaveBeenCalledExactlyOnceWith("openai-codex");
    restoreMissing();

    const invalid = prototypeWith(true);
    const restoreInvalid = installStartupAuthAdapter({
      isReady: () => {
        throw new Error("invalid private state");
      },
      piVersion: "0.84.2",
      runtimePrototype: invalid.prototype,
    });
    expect(invalid.prototype.hasConfiguredAuth("openai-codex")).toBe(true);
    expect(invalid.original).toHaveBeenCalledExactlyOnceWith("openai-codex");
    restoreInvalid();
  });

  it("shares one wrapper across duplicate installations", () => {
    const test = prototypeWith(false);
    const first = installStartupAuthAdapter({
      isReady: () => false,
      piVersion: "0.84.2",
      runtimePrototype: test.prototype,
    });
    const patched = test.prototype.hasConfiguredAuth;
    const second = installStartupAuthAdapter({
      isReady: () => true,
      piVersion: "0.84.2",
      runtimePrototype: test.prototype,
    });

    expect(test.prototype.hasConfiguredAuth).toBe(patched);
    expect(test.prototype.hasConfiguredAuth("openai-codex")).toBe(true);
    first();
    expect(test.prototype.hasConfiguredAuth).toBe(patched);
    expect(test.prototype.hasConfiguredAuth("openai-codex")).toBe(true);
    second();
    second();
    expect(test.prototype.hasConfiguredAuth).toBe(test.original);
  });

  it("leaves the runtime unchanged when method replacement fails", () => {
    const original = vi.fn((providerId: string) => providerId === "configured");
    const runtimePrototype = {} as RuntimePrototype;
    Object.defineProperty(runtimePrototype, "hasConfiguredAuth", {
      configurable: true,
      value: original,
      writable: false,
    });

    expect(() =>
      installStartupAuthAdapter({
        isReady: () => true,
        piVersion: "0.84.2",
        runtimePrototype,
      }),
    ).toThrow();
    expect(Reflect.get(runtimePrototype, "hasConfiguredAuth")).toBe(original);
  });

  it.each(["0.84.1", "0.85.0", "1.0.0", "0.84.2-beta.1"])(
    "rejects unsupported Pi version %s before patching",
    (piVersion) => {
      const test = prototypeWith(false);
      expect(() =>
        installStartupAuthAdapter({
          isReady: () => true,
          piVersion,
          runtimePrototype: test.prototype,
        }),
      ).toThrow("supports Pi >=0.84.2 <0.85.0");
      expect(test.prototype.hasConfiguredAuth).toBe(test.original);
    },
  );

  it("supports the installed Pi runtime and restores its exact method", () => {
    const original: unknown = Reflect.get(ModelRuntime.prototype, "hasConfiguredAuth");
    const restore = installStartupAuthAdapter({ isReady: () => false });
    expect(Reflect.get(ModelRuntime.prototype, "hasConfiguredAuth")).not.toBe(original);
    restore();
    expect(Reflect.get(ModelRuntime.prototype, "hasConfiguredAuth")).toBe(original);
  });
});

describe("startup auth adapter integration", () => {
  it("restores a synthetic session model before queued provider registration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-restore-"));
    const original: unknown = Reflect.get(ModelRuntime.prototype, "hasConfiguredAuth");
    let restore: (() => void) | undefined;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const native = openaiCodexProvider();
      const savedModel = native.getModels()[0];
      expect(savedModel).toBeDefined();
      if (!savedModel) return;
      const settingsManager = SettingsManager.inMemory();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(directory, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      expect(modelRuntime.hasConfiguredAuth("openai-codex")).toBe(false);
      const resourceLoader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: directory,
        settingsManager,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          {
            name: "codex-session-restore-test",
            factory: (pi) => {
              restore = installStartupAuthAdapter({ isReady: () => true });
              pi.registerProvider(native);
            },
          },
        ],
      });
      await resourceLoader.reload();
      const sessionManager = SessionManager.inMemory(directory);
      sessionManager.appendModelChange(savedModel.provider, savedModel.id);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Synthetic resumed session" }],
        timestamp: Date.now(),
      });

      const result = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        modelRuntime,
        resourceLoader,
        sessionManager,
        settingsManager,
        noTools: "all",
      });
      session = result.session;

      expect(result.modelFallbackMessage).toBeUndefined();
      expect(session.model?.provider).toBe("openai-codex");
      expect(session.model?.id).toBe(savedModel.id);
    } finally {
      restore?.();
      session?.dispose();
      expect(Reflect.get(ModelRuntime.prototype, "hasConfiguredAuth")).toBe(original);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
