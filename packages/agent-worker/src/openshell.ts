import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";

const PLACEHOLDER_PREFIX = "openshell:resolve:env:";
const ACCOUNT_CLAIMS = "https://api.openai.com/auth";

/** 2100-01-01. The gateway refreshes the real token behind the placeholder, so Pi AI never has to. */
const NEVER_EXPIRES = 4_102_444_800_000;

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Wraps the access token placeholder in the JWT shape that OpenShell resolves. Pi AI reads the
 * ChatGPT account id from the token's claims and sends it as a header, so the claims carry the
 * account id placeholder, which the proxy resolves in that header. The signature segment keeps the
 * access token placeholder, and the proxy replaces the whole token with the real one.
 */
export function codexTokenAlias(accessPlaceholder: string, accountIdPlaceholder: string): string {
  if (!accessPlaceholder.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error("CODEX_AUTH_ACCESS_TOKEN is not an OpenShell placeholder");
  }
  const header = base64url({ alg: "none", typ: "JWT" });
  const claims = base64url({ [ACCOUNT_CLAIMS]: { chatgpt_account_id: accountIdPlaceholder } });
  return `${header}.${claims}.OPENSHELL-RESOLVE-ENV-${accessPlaceholder.slice(PLACEHOLDER_PREFIX.length)}`;
}

/**
 * The Codex login inside an OpenShell sandbox. The attached provider injects placeholders for the
 * access token and the account id; the real tokens and the refresh token stay in the gateway.
 */
export function openshellCodexCredentials(env: NodeJS.ProcessEnv): CredentialStore {
  const access = env["CODEX_AUTH_ACCESS_TOKEN"];
  const accountId = env["CODEX_AUTH_ACCOUNT_ID"];
  if (access === undefined || access === "" || accountId === undefined || accountId === "") {
    throw new Error(
      "Attach the Codex provider: CODEX_AUTH_ACCESS_TOKEN and CODEX_AUTH_ACCOUNT_ID are not set",
    );
  }
  const credential: OAuthCredential = {
    access: codexTokenAlias(access, accountId),
    accountId,
    expires: NEVER_EXPIRES,
    refresh: "",
    type: "oauth",
  };
  const forCodex = (providerId: string) =>
    Promise.resolve(providerId === "openai-codex" ? credential : undefined);
  return {
    delete: () => Promise.resolve(),
    list: () => Promise.resolve([{ providerId: "openai-codex", type: "oauth" }]),
    // The login is read-only here; the gateway owns every change to it.
    modify: (providerId) => forCodex(providerId),
    read: (providerId) => forCodex(providerId),
  };
}
