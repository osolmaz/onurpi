import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  codexAuthPath,
  readCodexCliCredential,
  resolveCodexCliCredential,
} from "./credential-source.ts";

const directories: string[] = [];
const NOW = Date.UTC(2026, 7, 9);

function token(accountId: string, expiresAt = NOW + 60_000, marker = "one"): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: expiresAt / 1000,
      marker,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

async function temporaryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-auth-reload-"));
  directories.push(directory);
  return join(directory, "auth.json");
}

async function authFile(value: unknown): Promise<string> {
  const path = await temporaryPath();
  await writeFile(path, JSON.stringify(value));
  return path;
}

function authValue(accountId: string, accessToken = token(accountId)): unknown {
  return { auth_mode: "chatgpt", tokens: { access_token: accessToken, account_id: accountId } };
}

function runtimeHeaders(
  accountId: string,
  accessToken = token(accountId, NOW + 60_000, "runtime"),
) {
  return { Authorization: `Bearer ${accessToken}`, "chatgpt-account-id": accountId };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("codexAuthPath", () => {
  it("uses an explicit Codex home", () => {
    expect(codexAuthPath({ codexHome: "/tmp/codex-home", home: "/ignored" })).toBe(
      "/tmp/codex-home/auth.json",
    );
  });

  it("falls back to the home directory", () => {
    expect(codexAuthPath({ codexHome: "", home: "/home/tester" })).toBe(
      "/home/tester/.codex/auth.json",
    );
  });
});

describe("readCodexCliCredential", () => {
  it("reads a valid credential without returning file contents", async () => {
    const path = await authFile(authValue("account-one"));
    const result = await readCodexCliCredential({ path, now: NOW });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected credential");
    expect(result.credential.accountId).toBe("account-one");
    expect(result.credential.expiresAt).toBe(NOW + 60_000);
    expect(result.credential.revision).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses the JWT account when the redundant account field is absent", async () => {
    const accessToken = token("account-one");
    const path = await authFile({ tokens: { access_token: accessToken } });
    const result = await readCodexCliCredential({ path, now: NOW });
    expect(result.status === "ready" ? result.credential.accountId : result.issue).toBe(
      "account-one",
    );
  });

  it.each([
    ["missing", async () => temporaryPath()],
    ["malformed", async () => authFile({ tokens: { access_token: "not-a-jwt" } })],
    [
      "malformed",
      async () => {
        const path = await temporaryPath();
        await writeFile(path, "not json");
        return path;
      },
    ],
  ] as const)("reports %s input without throwing", async (issue, createPath) => {
    await expect(readCodexCliCredential({ path: await createPath(), now: NOW })).resolves.toEqual({
      status: "unavailable",
      issue,
    });
  });

  it.each([
    ["a missing signature", (payload: string) => `header.${payload}`],
    ["an empty header", (payload: string) => `.${payload}.signature`],
    ["an empty payload", () => "header..signature"],
    ["an extra segment", (payload: string) => `header.${payload}.signature.extra`],
    ["invalid payload JSON", () => "header.bm90IGpzb24.signature"],
    ["a non-object payload", () => `header.${Buffer.from("[]").toString("base64url")}.signature`],
  ])("rejects a JWT with %s", async (_description, createToken) => {
    const payload = token("account-one").split(".")[1];
    if (!payload) throw new Error("expected JWT payload");
    const path = await authFile(authValue("account-one", createToken(payload)));
    await expect(readCodexCliCredential({ path, now: NOW })).resolves.toEqual({
      status: "unavailable",
      issue: "malformed",
    });
  });

  it("rejects an oversized auth file", async () => {
    const path = await temporaryPath();
    await writeFile(path, " ".repeat(1024 * 1024 + 1));
    await expect(readCodexCliCredential({ path, now: NOW })).resolves.toEqual({
      status: "unavailable",
      issue: "malformed",
    });
  });

  it("rejects mismatched stored and JWT account IDs", async () => {
    const path = await authFile(authValue("stored-account", token("token-account")));
    await expect(readCodexCliCredential({ path, now: NOW })).resolves.toEqual({
      status: "unavailable",
      issue: "malformed",
    });
  });

  it("rejects expired credentials", async () => {
    const path = await authFile(authValue("account-one", token("account-one", NOW - 1)));
    await expect(readCodexCliCredential({ path, now: NOW })).resolves.toEqual({
      status: "unavailable",
      issue: "expired",
    });
  });
});

describe("resolveCodexCliCredential", () => {
  it("replaces a different token for the same account", async () => {
    const replacement = token("account-one", NOW + 60_000, "replacement");
    const path = await authFile(authValue("account-one", replacement));
    const result = await resolveCodexCliCredential({
      path,
      now: NOW,
      headers: runtimeHeaders("account-one"),
    });
    expect(result.status).toBe("replace");
    if (result.status !== "replace") throw new Error("expected replacement");
    expect(result.credential.accessToken).toBe(replacement);
  });

  it("recognizes the current token", async () => {
    const accessToken = token("account-one");
    const path = await authFile(authValue("account-one", accessToken));
    const result = await resolveCodexCliCredential({
      path,
      now: NOW,
      headers: runtimeHeaders("account-one", accessToken),
    });
    expect(result.status).toBe("current");
  });

  it("rejects a different account", async () => {
    const path = await authFile(authValue("account-two", token("account-two")));
    await expect(
      resolveCodexCliCredential({ path, now: NOW, headers: runtimeHeaders("account-one") }),
    ).resolves.toEqual({ status: "unavailable", issue: "account-mismatch" });
  });

  it("prefers the effective API key over a conflicting Authorization header", async () => {
    const path = await authFile(authValue("account-two", token("account-two")));
    await expect(
      resolveCodexCliCredential({
        path,
        now: NOW,
        apiKey: token("account-one"),
        headers: { authorization: `Bearer ${token("account-two")}` },
      }),
    ).resolves.toEqual({ status: "unavailable", issue: "account-mismatch" });
  });

  it("derives the runtime account from a bearer token", async () => {
    const replacement = token("account-one", NOW + 60_000, "replacement");
    const path = await authFile(authValue("account-one", replacement));
    const result = await resolveCodexCliCredential({
      path,
      now: NOW,
      headers: { authorization: `Bearer ${token("account-one")}` },
    });
    expect(result.status).toBe("replace");
  });

  it("rejects inconsistent runtime account headers", async () => {
    const path = await authFile(authValue("account-one"));
    const result = await resolveCodexCliCredential({
      path,
      now: NOW,
      headers: {
        authorization: `Bearer ${token("token-account")}`,
        "chatgpt-account-id": "header-account",
      },
    });
    expect(result).toEqual({ status: "unavailable", issue: "runtime-account-unavailable" });
  });

  it("accepts an API key when Authorization is absent", async () => {
    const replacement = token("account-one", NOW + 60_000, "replacement");
    const path = await authFile(authValue("account-one", replacement));
    const result = await resolveCodexCliCredential({
      path,
      now: NOW,
      apiKey: token("account-one"),
      headers: {},
    });
    expect(result.status).toBe("replace");
  });
});
