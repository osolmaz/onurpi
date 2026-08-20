import type {
  AuthEvent,
  AuthPrompt,
  OAuthAuth,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  parseCodexSwitcherConfig,
  type BillingPolicy,
  type CodexAccount,
  type CodexSwitcherConfig,
} from "./config.ts";
import type { AccountUsageState, SwitcherState } from "./router.ts";
import { minimumRemaining } from "./usage-policy.ts";
import type { AccountVault } from "./vault.ts";

export type ConfigController = {
  get(): CodexSwitcherConfig;
  replace(config: CodexSwitcherConfig): void;
};

export type AccountManagerOptions = {
  config: ConfigController;
  oauth: OAuthAuth;
  pi: Pick<ExtensionAPI, "exec">;
  state: SwitcherState;
  vault: AccountVault;
};

function configuredAccount(config: CodexSwitcherConfig, id: string): CodexAccount {
  const account = config.accounts.find((candidate) => candidate.id === id);
  if (!account) throw new Error(`Unknown Codex account: ${id}`);
  return account;
}

function assertAccountMutable(id: string, state: SwitcherState): void {
  if (state.agentRunActive && state.leaseAccountId === id) {
    throw new Error(`Wait for the current Codex run to finish before changing account: ${id}`);
  }
}

function usageText(usage: AccountUsageState | undefined): string {
  if (usage?.status === "failed") return usage.message;
  if (usage?.status !== "ready") return "usage unknown";
  const remaining = minimumRemaining(usage.report);
  const resets = usage.report.buckets
    .map((bucket) => bucket.resetsAt)
    .filter((value): value is number => value !== undefined);
  const reset =
    resets.length > 0 ? `, resets ${new Date(Math.min(...resets) * 1_000).toISOString()}` : "";
  return remaining === undefined
    ? `usage available${reset}`
    : `${Math.max(0, remaining).toFixed(0)}% remaining${reset}`;
}

async function statusLines(options: AccountManagerOptions): Promise<string[]> {
  const config = options.config.get();
  if (config.accounts.length === 0) return ["No Codex accounts are configured."];
  return Promise.all(
    config.accounts.map(async (account, index) => {
      const authenticated = await options.vault.has(account.id);
      const active = options.state.activeAccountId === account.id ? ", active" : "";
      return `${String(index + 1)}. ${account.id}: ${authenticated ? "authenticated" : "not authenticated"}, ${account.billing}, ${usageText(options.state.usageByAccount.get(account.id))}${active}`;
    }),
  );
}

function browserCommand(url: string): { command: string; args: string[] } | undefined {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (process.platform === "linux") return { command: "xdg-open", args: [url] };
  return undefined;
}

function notifyAuthEvent(
  event: AuthEvent,
  ctx: ExtensionCommandContext,
  pi: Pick<ExtensionAPI, "exec">,
): void {
  if (event.type === "auth_url") {
    ctx.ui.notify(`${event.instructions ?? "Open this URL to continue:"}\n${event.url}`, "info");
    const command = browserCommand(event.url);
    if (command) void pi.exec(command.command, command.args).catch(() => undefined);
    return;
  }
  if (event.type === "device_code") {
    ctx.ui.notify(`Open ${event.verificationUri} and enter code ${event.userCode}.`, "info");
    return;
  }
  if (event.type === "info") {
    const links = event.links?.map((link) => link.url).join("\n");
    ctx.ui.notify(links ? `${event.message}\n${links}` : event.message, "info");
    return;
  }
  ctx.ui.setStatus("codex-switcher-auth", event.message);
}

function dialogSignal(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined;
}

async function promptAuth(prompt: AuthPrompt, ctx: ExtensionCommandContext): Promise<string> {
  if (prompt.type === "select") {
    const labels = prompt.options.map((option) => option.label);
    const selected = await ctx.ui.select(prompt.message, labels, dialogSignal(prompt.signal));
    const index = selected === undefined ? -1 : labels.indexOf(selected);
    const value = index < 0 ? undefined : prompt.options[index]?.id;
    if (!value) throw new Error("Authentication was cancelled.");
    return value;
  }
  const value = await ctx.ui.input(prompt.message, prompt.placeholder, dialogSignal(prompt.signal));
  if (!value) throw new Error("Authentication was cancelled.");
  return value;
}

function interaction(
  ctx: ExtensionCommandContext,
  pi: Pick<ExtensionAPI, "exec">,
  signal: AbortSignal,
): ProviderAuthInteraction {
  return {
    signal,
    notify: (event) => {
      notifyAuthEvent(event, ctx, pi);
    },
    prompt: (prompt) => promptAuth(prompt, ctx),
  };
}

async function login(
  accountId: string,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  configuredAccount(options.config.get(), accountId);
  assertAccountMutable(accountId, options.state);
  const controller = new AbortController();
  try {
    const credential = await options.oauth.login(interaction(ctx, options.pi, controller.signal));
    await options.vault.set(accountId, credential, controller.signal);
    ctx.ui.notify(`Authenticated Codex account: ${accountId}`, "info");
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication was cancelled.") throw error;
    throw new Error("Codex authentication failed.");
  } finally {
    ctx.ui.setStatus("codex-switcher-auth", undefined);
  }
}

function replaceAccounts(options: AccountManagerOptions, accounts: readonly CodexAccount[]): void {
  const current = options.config.get();
  options.config.replace(
    parseCodexSwitcherConfig({
      accounts,
      usage: {
        refreshMinutes: current.refreshMs / 60_000,
        timeoutSeconds: current.timeoutMs / 1_000,
      },
    }),
  );
}

function parseBilling(value: string | undefined): BillingPolicy {
  if (value === "subscription-only" || value === "allow-credits") return value;
  throw new Error("Billing policy must be subscription-only or allow-credits.");
}

async function add(
  id: string | undefined,
  billingValue: string | undefined,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  if (!id) throw new Error("Usage: /codex-switcher add <account> <billing-policy>");
  const billing = parseBilling(billingValue);
  const current = options.config.get();
  if (current.accounts.some((account) => account.id === id)) {
    throw new Error(`Codex account already exists: ${id}`);
  }
  replaceAccounts(options, [...current.accounts, { id, billing }]);
  await login(id, ctx, options);
}

async function remove(
  id: string | undefined,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  if (!id) throw new Error("Usage: /codex-switcher remove <account>");
  configuredAccount(options.config.get(), id);
  assertAccountMutable(id, options.state);
  if (!(await ctx.ui.confirm("Remove Codex account?", `Remove ${id} and its saved credential?`)))
    return;
  await options.vault.remove(id);
  replaceAccounts(
    options,
    options.config.get().accounts.filter((account) => account.id !== id),
  );
  if (options.state.activeAccountId === id) options.state.activeAccountId = undefined;
  if (options.state.leaseAccountId === id) options.state.leaseAccountId = undefined;
  options.state.usageByAccount.delete(id);
  ctx.ui.notify(`Removed Codex account: ${id}`, "info");
}

function setBilling(
  id: string | undefined,
  value: string | undefined,
  options: AccountManagerOptions,
): void {
  if (!id) throw new Error("Usage: /codex-switcher billing <account> <billing-policy>");
  configuredAccount(options.config.get(), id);
  assertAccountMutable(id, options.state);
  const billing = parseBilling(value);
  replaceAccounts(
    options,
    options.config
      .get()
      .accounts.map((account) => (account.id === id ? { ...account, billing } : account)),
  );
}

function move(
  id: string | undefined,
  direction: string | undefined,
  options: AccountManagerOptions,
): void {
  if (!id || (direction !== "up" && direction !== "down")) {
    throw new Error("Usage: /codex-switcher move <account> <up|down>");
  }
  const accounts = [...options.config.get().accounts];
  const index = accounts.findIndex((account) => account.id === id);
  if (index < 0) throw new Error(`Unknown Codex account: ${id}`);
  assertAccountMutable(id, options.state);
  const target = direction === "up" ? index - 1 : index + 1;
  const current = accounts[index];
  const replacement = accounts[target];
  if (!current || !replacement) return;
  accounts[index] = replacement;
  accounts[target] = current;
  replaceAccounts(options, accounts);
}

async function showStatus(
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  ctx.ui.notify((await statusLines(options)).join("\n"), "info");
}

async function interactiveAdd(
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  const id = await ctx.ui.input("Account ID", "primary");
  const billing = await ctx.ui.select("Billing policy", ["subscription-only", "allow-credits"]);
  await add(id, billing, ctx, options);
}

async function selectConfiguredAccount(
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<string | undefined> {
  const ids = options.config.get().accounts.map((account) => account.id);
  if (ids.length > 0) return ctx.ui.select("Codex account", ids);
  ctx.ui.notify("No Codex accounts are configured.", "warning");
  return undefined;
}

async function interactiveAccountAction(
  action: string,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  const id = await selectConfiguredAccount(ctx, options);
  if (!id) return;
  const actions: Record<string, () => Promise<void>> = {
    "Reauthenticate account": () => login(id, ctx, options),
    "Remove account": () => remove(id, ctx, options),
    "Change billing policy": async () => {
      const billing = await ctx.ui.select("Billing policy", ["subscription-only", "allow-credits"]);
      setBilling(id, billing, options);
    },
    "Move account": async () => {
      const direction = await ctx.ui.select("Move account", ["up", "down"]);
      move(id, direction, options);
    },
  };
  await actions[action]?.();
}

async function interactive(
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  const action = await ctx.ui.select("Codex account manager", [
    "Show status",
    "Add account",
    "Reauthenticate account",
    "Remove account",
    "Change billing policy",
    "Move account",
  ]);
  if (!action || action === "Show status") {
    await showStatus(ctx, options);
    return;
  }
  if (action === "Add account") {
    await interactiveAdd(ctx, options);
    return;
  }
  await interactiveAccountAction(action, ctx, options);
}

async function dispatchCommand(
  rawArgs: string,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  const [command, first, second] = rawArgs.trim().split(/\s+/u);
  if (!command) {
    await interactive(ctx, options);
    return;
  }
  const commands: Record<string, () => Promise<void>> = {
    status: () => showStatus(ctx, options),
    add: () => add(first, second, ctx, options),
    login: () => login(first ?? "", ctx, options),
    remove: () => remove(first, ctx, options),
    billing: () => {
      setBilling(first, second, options);
      return Promise.resolve();
    },
    move: () => {
      move(first, second, options);
      return Promise.resolve();
    },
  };
  const handler = commands[command];
  if (!handler) throw new Error("Use status, add, login, remove, billing, or move.");
  await handler();
}

export async function runAccountManager(
  rawArgs: string,
  ctx: ExtensionCommandContext,
  options: AccountManagerOptions,
): Promise<void> {
  try {
    await dispatchCommand(rawArgs, ctx, options);
  } catch (error) {
    ctx.ui.notify(
      error instanceof Error ? error.message : "Codex account manager failed.",
      "error",
    );
  }
}
