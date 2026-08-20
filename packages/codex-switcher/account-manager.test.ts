import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UsageReport } from "@onurpi/pi-usage";
import { describe, expect, it, vi } from "vitest";

import {
  runAccountManager,
  type AccountManagerOptions,
  type ConfigController,
} from "./account-manager.ts";
import type { CodexSwitcherConfig } from "./config.ts";
import type { SwitcherState } from "./router.ts";
import type { AccountVault } from "./vault.ts";

function credential(): OAuthCredential {
  return {
    type: "oauth",
    access: "private-access",
    refresh: "private-refresh",
    expires: Date.now() + 3_600_000,
  };
}

function setup(initialAccounts: CodexSwitcherConfig["accounts"] = []) {
  let current: CodexSwitcherConfig = {
    accounts: initialAccounts,
    refreshMs: 300_000,
    timeoutMs: 10_000,
  };
  const config: ConfigController = {
    get: () => current,
    replace: (next) => {
      current = next;
    },
  };
  const credentials = new Set<string>();
  const vault: AccountVault = {
    has: (id) => Promise.resolve(credentials.has(id)),
    hasAnySync: (ids) => ids.some((id) => credentials.has(id)),
    list: () => Promise.resolve([...credentials]),
    remove: (id) => Promise.resolve(credentials.delete(id)),
    resolve: (id) =>
      Promise.resolve(credentials.has(id) ? { apiKey: "private-access" } : undefined),
    set: (id) => {
      credentials.add(id);
      return Promise.resolve();
    },
  };
  const login = vi.fn(() => Promise.resolve(credential()));
  const oauth: OAuthAuth = {
    name: "Test OAuth",
    login,
    refresh: vi.fn((value: OAuthCredential) => Promise.resolve(value)),
    toAuth: vi.fn((value: OAuthCredential) => Promise.resolve({ apiKey: value.access })),
  };
  const state: SwitcherState = {
    activeAccountId: undefined,
    agentRunActive: false,
    leaseAccountId: undefined,
    usageByAccount: new Map(),
  };
  const exec = vi.fn(() => Promise.resolve({ code: 0, stdout: "", stderr: "", killed: false }));
  const options: AccountManagerOptions = {
    config,
    oauth,
    pi: { exec },
    state,
    vault,
  };
  const confirm = vi.fn(() => Promise.resolve(true));
  const input = vi.fn(() => Promise.resolve<string | undefined>(undefined));
  const notify = vi.fn();
  const select = vi.fn(() => Promise.resolve<string | undefined>(undefined));
  const setStatus = vi.fn();
  const context = {
    ui: { confirm, input, notify, select, setStatus },
  } as unknown as ExtensionCommandContext;
  return {
    config,
    confirm,
    context,
    credentials,
    exec,
    input,
    login,
    notify,
    oauth,
    options,
    select,
    setStatus,
    state,
  };
}

describe("Codex account manager", () => {
  it("adds and authenticates an account through the official OAuth object", async () => {
    const test = setup();
    await runAccountManager("add primary subscription-only", test.context, test.options);
    expect(test.config.get().accounts).toEqual([{ id: "primary", billing: "subscription-only" }]);
    expect(test.credentials.has("primary")).toBe(true);
    expect(test.login).toHaveBeenCalledOnce();
    expect(test.notify).toHaveBeenCalledWith("Authenticated Codex account: primary", "info");
  });

  it("reauthenticates a configured account without changing its order", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    await runAccountManager("login primary", test.context, test.options);
    expect(test.config.get().accounts[0]?.id).toBe("primary");
    expect(test.credentials.has("primary")).toBe(true);
  });

  it("changes billing policy and account order", async () => {
    const test = setup([
      { id: "primary", billing: "subscription-only" },
      { id: "backup", billing: "subscription-only" },
    ]);
    await runAccountManager("billing backup allow-credits", test.context, test.options);
    await runAccountManager("move backup up", test.context, test.options);
    expect(test.config.get().accounts).toEqual([
      { id: "backup", billing: "allow-credits" },
      { id: "primary", billing: "subscription-only" },
    ]);
  });

  it("removes account policy, credentials, usage, and lease after confirmation", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    await test.options.vault.set("primary", credential());
    test.state.activeAccountId = "primary";
    test.state.leaseAccountId = "primary";
    test.state.usageByAccount.set("primary", { status: "unknown" });
    await runAccountManager("remove primary", test.context, test.options);
    expect(test.config.get().accounts).toEqual([]);
    expect(test.credentials.has("primary")).toBe(false);
    expect(test.state.activeAccountId).toBeUndefined();
    expect(test.state.leaseAccountId).toBeUndefined();
    expect(test.state.usageByAccount.has("primary")).toBe(false);
  });

  it("blocks changes to the leased account until the run settles", async () => {
    const test = setup([
      { id: "primary", billing: "subscription-only" },
      { id: "backup", billing: "subscription-only" },
    ]);
    await test.options.vault.set("primary", credential());
    test.state.agentRunActive = true;
    test.state.leaseAccountId = "primary";

    await runAccountManager("login primary", test.context, test.options);
    await runAccountManager("remove primary", test.context, test.options);
    await runAccountManager("billing primary allow-credits", test.context, test.options);
    await runAccountManager("move primary down", test.context, test.options);

    expect(test.login).not.toHaveBeenCalled();
    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.credentials.has("primary")).toBe(true);
    expect(test.config.get().accounts).toEqual([
      { id: "primary", billing: "subscription-only" },
      { id: "backup", billing: "subscription-only" },
    ]);
    expect(test.notify).toHaveBeenCalledTimes(4);
    expect(test.notify).toHaveBeenLastCalledWith(
      "Wait for the current Codex run to finish before changing account: primary",
      "error",
    );
  });

  it("shows policy and status without credential values", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    await test.options.vault.set("primary", credential());
    await runAccountManager("status", test.context, test.options);
    const message = String(test.notify.mock.calls[0]?.[0]);
    expect(message).toContain("primary: authenticated, subscription-only");
    expect(message).not.toContain("private-access");
    expect(message).not.toContain("private-refresh");
  });
});

describe("interactive Codex account manager", () => {
  it("runs the interactive add flow and bridges official OAuth prompts", async () => {
    const test = setup();
    test.select
      .mockResolvedValueOnce("Add account")
      .mockResolvedValueOnce("subscription-only")
      .mockResolvedValueOnce("Browser login");
    test.input.mockResolvedValueOnce("primary").mockResolvedValueOnce("manual-code");
    const oauthLogin = vi.fn(async (auth: ProviderAuthInteraction) => {
      auth.notify({ type: "auth_url", url: "https://auth.openai.com/authorize?state=test" });
      auth.notify({
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://auth.openai.com/device",
      });
      auth.notify({
        type: "info",
        message: "Authentication information",
        links: [{ url: "https://auth.openai.com/help" }],
      });
      auth.notify({ type: "progress", message: "Waiting for OpenAI" });
      await auth.prompt({
        type: "select",
        message: "Login method",
        options: [{ id: "browser", label: "Browser login" }],
      });
      await auth.prompt({ type: "manual_code", message: "Paste callback" });
      return credential();
    });
    test.options.oauth = { ...test.oauth, login: oauthLogin };

    await runAccountManager("", test.context, test.options);

    expect(test.config.get().accounts[0]?.id).toBe("primary");
    expect(test.credentials.has("primary")).toBe(true);
    expect(test.exec).toHaveBeenCalled();
    expect(test.setStatus).toHaveBeenCalledWith("codex-switcher-auth", "Waiting for OpenAI");
    expect(test.setStatus).toHaveBeenLastCalledWith("codex-switcher-auth", undefined);
  });

  it("handles interactive account actions and an empty account list", async () => {
    const empty = setup();
    empty.select.mockResolvedValueOnce("Remove account");
    await runAccountManager("", empty.context, empty.options);
    expect(empty.notify).toHaveBeenCalledWith("No Codex accounts are configured.", "warning");

    const configured = setup([
      { id: "primary", billing: "subscription-only" },
      { id: "backup", billing: "subscription-only" },
    ]);
    configured.select
      .mockResolvedValueOnce("Change billing policy")
      .mockResolvedValueOnce("backup")
      .mockResolvedValueOnce("allow-credits");
    await runAccountManager("", configured.context, configured.options);
    expect(configured.config.get().accounts[1]?.billing).toBe("allow-credits");
  });

  it("reports usage and reset details without provider payloads", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    const report: UsageReport = {
      providerId: "openai-codex",
      providerName: "OpenAI Codex",
      capturedAt: 1,
      source: "test",
      semantics: { kind: "consumer-subscription", label: "Subscription" },
      buckets: [
        {
          id: "codex:primary",
          groupId: "codex",
          label: "Primary",
          remaining: 25,
          resetsAt: 2_000_000_000,
          unit: "percent",
        },
      ],
      metrics: [],
    };
    test.state.usageByAccount.set("primary", { status: "ready", report });
    await runAccountManager("status", test.context, test.options);
    expect(String(test.notify.mock.calls.at(-1)?.[0])).toContain("25% remaining, resets");
    test.state.usageByAccount.set("primary", {
      status: "failed",
      message: "usage check unavailable",
    });
    await runAccountManager("status", test.context, test.options);
    expect(String(test.notify.mock.calls.at(-1)?.[0])).toContain("usage check unavailable");
  });

  it("keeps accounts when removal is cancelled and ignores boundary moves", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    test.confirm.mockResolvedValueOnce(false);
    await runAccountManager("remove primary", test.context, test.options);
    await runAccountManager("move primary up", test.context, test.options);
    expect(test.config.get().accounts).toEqual([{ id: "primary", billing: "subscription-only" }]);
  });

  it("shows status when the interactive menu is dismissed", async () => {
    const test = setup();
    await runAccountManager("", test.context, test.options);
    expect(test.notify).toHaveBeenCalledWith("No Codex accounts are configured.", "info");
  });

  it("preserves the safe cancellation message", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    test.options.oauth = {
      ...test.oauth,
      login: vi.fn(() => Promise.reject(new Error("Authentication was cancelled."))),
    };
    await runAccountManager("login primary", test.context, test.options);
    expect(test.notify).toHaveBeenCalledWith("Authentication was cancelled.", "error");
  });

  it("reports OAuth failures with a redacted error", async () => {
    const test = setup([{ id: "primary", billing: "subscription-only" }]);
    test.options.oauth = {
      ...test.oauth,
      login: vi.fn(() => Promise.reject(new Error("response private-access"))),
    };
    await runAccountManager("login primary", test.context, test.options);
    expect(test.notify).toHaveBeenCalledWith("Codex authentication failed.", "error");
    expect(String(test.notify.mock.calls.at(-1)?.[0])).not.toContain("private-access");
  });

  it("reports invalid commands without throwing or exposing OAuth values", async () => {
    const test = setup();
    await expect(
      runAccountManager("add BAD automatic", test.context, test.options),
    ).resolves.toBeUndefined();
    expect(test.notify).toHaveBeenCalledWith(
      "Billing policy must be subscription-only or allow-credits.",
      "error",
    );
    await runAccountManager("unknown", test.context, test.options);
    expect(test.notify).toHaveBeenLastCalledWith(
      "Use status, add, login, remove, billing, or move.",
      "error",
    );
  });
});
