import type { ModelAuth, OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { join } from "node:path";

import {
  isMissingFileError,
  readPrivateFile,
  withPrivateFileLock,
  writePrivateFile,
} from "./private-file.ts";

const MAX_VAULT_BYTES = 512 * 1024;
const MAX_SECRET_BYTES = 128 * 1024;
const REFRESH_SKEW_MS = 60_000;
const VAULT_VERSION = 1;
const ACCOUNT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type AccountVault = {
  has(accountId: string): Promise<boolean>;
  hasAnySync(accountIds: readonly string[]): boolean;
  list(): Promise<readonly string[]>;
  remove(accountId: string, signal?: AbortSignal): Promise<boolean>;
  resolve(accountId: string, signal: AbortSignal): Promise<ModelAuth | undefined>;
  set(accountId: string, credential: OAuthCredential, signal?: AbortSignal): Promise<void>;
};

type VaultDocument = {
  version: typeof VAULT_VERSION;
  accounts: Record<string, OAuthCredential>;
};

type JsonObject = Record<string, unknown>;

export function codexSwitcherVaultPath(agentDir: string): string {
  return join(agentDir, "codex-switcher-auth.json");
}

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as JsonObject;
}

function boundedSecret(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= MAX_SECRET_BYTES
  );
}

function parseCredential(raw: unknown): OAuthCredential {
  const value = object(raw, "vault credential");
  if (
    value["type"] !== "oauth" ||
    !boundedSecret(value["refresh"]) ||
    !boundedSecret(value["access"]) ||
    typeof value["expires"] !== "number" ||
    !Number.isSafeInteger(value["expires"]) ||
    value["expires"] <= 0
  ) {
    throw new Error("Vault contains an invalid OAuth credential.");
  }
  return structuredClone(value) as OAuthCredential;
}

function emptyDocument(): VaultDocument {
  return { version: VAULT_VERSION, accounts: {} };
}

function parseDocument(raw: unknown): VaultDocument {
  const value = object(raw, "vault");
  if (value["version"] !== VAULT_VERSION) throw new Error("Vault has an unsupported version.");
  const rawAccounts = object(value["accounts"], "vault.accounts");
  const entries = Object.entries(rawAccounts);
  if (entries.length > 16) throw new Error("Vault contains too many accounts.");
  if (entries.some(([id]) => id.length > 48 || !ACCOUNT_ID.test(id))) {
    throw new Error("Vault contains an invalid account ID.");
  }
  return {
    version: VAULT_VERSION,
    accounts: Object.fromEntries(
      entries.map(([id, credential]) => [id, parseCredential(credential)]),
    ),
  };
}

function readDocument(path: string): VaultDocument {
  try {
    return parseDocument(JSON.parse(readPrivateFile(path, MAX_VAULT_BYTES)) as unknown);
  } catch (error) {
    if (isMissingFileError(error)) return emptyDocument();
    if (error instanceof SyntaxError) throw new Error("Vault contains invalid JSON.");
    throw error;
  }
}

function writeDocument(path: string, document: VaultDocument): void {
  writePrivateFile(path, `${JSON.stringify(document)}\n`, MAX_VAULT_BYTES);
}

function officialAuth(auth: ModelAuth): ModelAuth {
  if (auth.baseUrl !== undefined) {
    const url = new URL(auth.baseUrl);
    if (
      url.origin !== "https://chatgpt.com" ||
      url.pathname.replace(/\/+$/u, "") !== "/backend-api" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("Codex account authentication is restricted to the official endpoint.");
    }
  }
  return auth;
}

export function createAccountVault(path: string, oauth: OAuthAuth): AccountVault {
  let pending: Promise<unknown> = Promise.resolve();

  const mutate = <T>(
    signal: AbortSignal,
    operation: (
      document: VaultDocument,
    ) => Promise<{ document: VaultDocument; result: T }> | { document: VaultDocument; result: T },
  ): Promise<T> => {
    const run = pending.then(() =>
      withPrivateFileLock(path, signal, async () => {
        const outcome = await operation(readDocument(path));
        writeDocument(path, outcome.document);
        return outcome.result;
      }),
    );
    pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    has: (accountId) =>
      Promise.resolve().then(() => Object.hasOwn(readDocument(path).accounts, accountId)),
    hasAnySync: (accountIds) => {
      const accounts = readDocument(path).accounts;
      return accountIds.some((accountId) => Object.hasOwn(accounts, accountId));
    },
    list: () => Promise.resolve().then(() => Object.keys(readDocument(path).accounts)),
    remove: (accountId, signal = new AbortController().signal) =>
      mutate(signal, (document) => {
        if (!Object.hasOwn(document.accounts, accountId)) return { document, result: false };
        const accounts = Object.fromEntries(
          Object.entries(document.accounts).filter(([id]) => id !== accountId),
        );
        return { document: { ...document, accounts }, result: true };
      }),
    resolve: async (accountId, signal) => {
      let credential = readDocument(path).accounts[accountId];
      if (!credential) return undefined;
      if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
        credential = await mutate(signal, async (document) => {
          const current = document.accounts[accountId];
          if (!current) return { document, result: undefined };
          if (current.expires > Date.now() + REFRESH_SKEW_MS) {
            return { document, result: current };
          }
          const refreshed = parseCredential(await oauth.refresh(current, signal));
          return {
            document: {
              ...document,
              accounts: { ...document.accounts, [accountId]: refreshed },
            },
            result: refreshed,
          };
        });
      }
      return credential ? officialAuth(await oauth.toAuth(credential)) : undefined;
    },
    set: (accountId, credential, signal = new AbortController().signal) =>
      mutate(signal, (document) => ({
        document: {
          ...document,
          accounts: { ...document.accounts, [accountId]: parseCredential(credential) },
        },
        result: undefined,
      })),
  };
}
