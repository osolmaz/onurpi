import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { codexSwitcherVaultPath, createAccountVault } from "./vault.ts";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "codex-vault-"));
  directories.push(directory);
  return directory;
}

function credential(access = "access-secret", expires = Date.now() + 3_600_000): OAuthCredential {
  return {
    type: "oauth",
    access,
    refresh: "refresh-secret",
    expires,
    accountId: "private-account-id",
  };
}

function oauth(refresh = vi.fn(() => Promise.resolve(credential("refreshed-access")))): OAuthAuth {
  return {
    name: "Test OAuth",
    login: vi.fn(),
    refresh,
    toAuth: vi.fn((value: OAuthCredential) => {
      const rawAccountId = Object.entries(value).find(([key]) => key === "accountId")?.[1];
      const accountId = typeof rawAccountId === "string" ? rawAccountId : "";
      return Promise.resolve({
        apiKey: value.access,
        headers: { "chatgpt-account-id": accountId },
      });
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("account vault", () => {
  it("stores multiple OAuth accounts in one private atomic file", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    const vault = createAccountVault(path, oauth());
    await vault.set("primary", credential("primary-secret"));
    await vault.set("backup", credential("backup-secret"));

    expect(await vault.list()).toEqual(["primary", "backup"]);
    expect(await vault.has("primary")).toBe(true);
    expect((await vault.resolve("backup", new AbortController().signal))?.apiKey).toBe(
      "backup-secret",
    );
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain(".tmp");
  });

  it("refreshes an expiring credential and saves the rotated value", async () => {
    const refresh = vi.fn(() => Promise.resolve(credential("refreshed-access")));
    const native = oauth(refresh);
    const path = join(temporaryDirectory(), "vault.json");
    const vault = createAccountVault(path, native);
    await vault.set("primary", credential("expired-access", Date.now() - 1));

    expect((await vault.resolve("primary", new AbortController().signal))?.apiKey).toBe(
      "refreshed-access",
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(readFileSync(path, "utf8")).toContain("refreshed-access");
  });

  it("serializes concurrent changes without losing an account", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    const vault = createAccountVault(path, oauth());
    await Promise.all([
      vault.set("primary", credential("one")),
      vault.set("backup", credential("two")),
    ]);
    expect(new Set(await vault.list())).toEqual(new Set(["primary", "backup"]));
  });

  it("removes only the requested account", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    const vault = createAccountVault(path, oauth());
    await vault.set("primary", credential("one"));
    await vault.set("backup", credential("two"));
    await expect(vault.remove("primary")).resolves.toBe(true);
    await expect(vault.remove("missing")).resolves.toBe(false);
    expect(await vault.list()).toEqual(["backup"]);
  });

  it("rejects permissive and symbolic-link vault files", async () => {
    const directory = temporaryDirectory();
    const target = join(directory, "target.json");
    writeFileSync(target, JSON.stringify({ version: 1, accounts: {} }), { mode: 0o644 });
    const vault = createAccountVault(target, oauth());
    await expect(vault.list()).rejects.toThrow("permissions must be 0600");

    const link = join(directory, "link.json");
    symlinkSync(target, link);
    await expect(createAccountVault(link, oauth()).list()).rejects.toThrow("not a regular file");
  });

  it("returns no auth for a missing account and validates resolved endpoints", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    const vault = createAccountVault(path, oauth());
    await expect(vault.resolve("missing", new AbortController().signal)).resolves.toBeUndefined();
    await vault.set("primary", credential());

    const official: OAuthAuth = {
      ...oauth(),
      toAuth: vi.fn(() =>
        Promise.resolve({
          apiKey: "access-secret",
          baseUrl: "https://chatgpt.com/backend-api/",
        }),
      ),
    };
    await expect(
      createAccountVault(path, official).resolve("primary", new AbortController().signal),
    ).resolves.toMatchObject({ baseUrl: "https://chatgpt.com/backend-api/" });

    const custom: OAuthAuth = {
      ...oauth(),
      toAuth: vi.fn(() =>
        Promise.resolve({ apiKey: "access-secret", baseUrl: "https://example.test" }),
      ),
    };
    await expect(
      createAccountVault(path, custom).resolve("primary", new AbortController().signal),
    ).rejects.toThrow("official endpoint");
  });

  it("rejects unsupported vault versions, IDs, and credentials", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    const documents = [
      { version: 2, accounts: {} },
      { version: 1, accounts: { "BAD ID": credential() } },
      { version: 1, accounts: { primary: { type: "oauth" } } },
    ];
    for (const document of documents) {
      writeFileSync(path, JSON.stringify(document), { mode: 0o600 });
      await expect(createAccountVault(path, oauth()).list()).rejects.toThrow();
    }
  });

  it("does not include credential contents in parse errors", async () => {
    const path = join(temporaryDirectory(), "vault.json");
    writeFileSync(path, "{private-access-token", { mode: 0o600 });
    await expect(createAccountVault(path, oauth()).list()).rejects.toThrow("invalid JSON");
    try {
      await createAccountVault(path, oauth()).list();
    } catch (error) {
      expect(String(error)).not.toContain("private-access-token");
    }
  });
});

it("builds the canonical vault path", () => {
  expect(codexSwitcherVaultPath("/agent")).toBe(join("/agent", "codex-switcher-auth.json"));
});
