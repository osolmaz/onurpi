import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const AUTH_CLAIM = "https://api.openai.com/auth";
const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export type ProviderHeaders = Record<string, string | null>;

export type CodexCliCredential = {
  accessToken: string;
  accountId: string;
  expiresAt: number;
  revision: string;
};

export type CredentialIssue =
  | "missing"
  | "unreadable"
  | "malformed"
  | "expired"
  | "runtime-account-unavailable"
  | "account-mismatch";

export type CredentialReadResult =
  | { status: "ready"; credential: CodexCliCredential }
  | {
      status: "unavailable";
      issue: Exclude<CredentialIssue, "runtime-account-unavailable" | "account-mismatch">;
    };

export type CredentialResolution =
  | { status: "replace"; credential: CodexCliCredential }
  | { status: "current"; credential: CodexCliCredential }
  | { status: "unavailable"; issue: CredentialIssue };

type JsonObject = Record<string, unknown>;

type CodexAuthPathOptions = {
  codexHome?: string;
  home?: string;
};

type ReadOptions = CodexAuthPathOptions & {
  path?: string;
  now?: number;
};

type ResolveOptions = ReadOptions & {
  apiKey?: string;
  headers: ProviderHeaders;
};

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(value: JsonObject | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function parseJwtPayload(token: string): JsonObject | undefined {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) return undefined;
  try {
    return asObject(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown);
  } catch {
    return undefined;
  }
}

function jwtAccountId(payload: JsonObject): string | undefined {
  return stringField(asObject(payload[AUTH_CLAIM]), "chatgpt_account_id");
}

function jwtExpiresAt(payload: JsonObject): number | undefined {
  const exp = payload["exp"];
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
}

function credentialRevision(accessToken: string, accountId: string): string {
  return createHash("sha256").update(accountId).update("\0").update(accessToken).digest("hex");
}

function consistentAccountId(
  storedAccountId: string | undefined,
  tokenAccountId: string | undefined,
): string | undefined {
  if (storedAccountId && tokenAccountId && storedAccountId !== tokenAccountId) return undefined;
  return storedAccountId ?? tokenAccountId;
}

function credentialFields(value: unknown): Omit<CodexCliCredential, "revision"> | undefined {
  const tokens = asObject(asObject(value)?.["tokens"]);
  const accessToken = stringField(tokens, "access_token");
  if (!accessToken) return undefined;
  const payload = parseJwtPayload(accessToken);
  if (!payload) return undefined;
  const accountId = consistentAccountId(stringField(tokens, "account_id"), jwtAccountId(payload));
  const expiresAt = jwtExpiresAt(payload);
  return accountId && expiresAt ? { accessToken, accountId, expiresAt } : undefined;
}

function parseCredential(value: unknown, now: number): CredentialReadResult {
  const fields = credentialFields(value);
  if (!fields) return { status: "unavailable", issue: "malformed" };
  if (fields.expiresAt <= now) return { status: "unavailable", issue: "expired" };
  return {
    status: "ready",
    credential: {
      ...fields,
      revision: credentialRevision(fields.accessToken, fields.accountId),
    },
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function headerEntries(headers: ProviderHeaders, name: string): [string, string][] {
  return Object.entries(headers).flatMap(([key, value]) =>
    key.toLowerCase() === name.toLowerCase() && typeof value === "string" ? [[key, value]] : [],
  );
}

function bearerToken(value: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/iu.exec(value ?? "");
  return match?.[1];
}

function accountIdFromToken(token: string | undefined): string | undefined {
  return token ? jwtAccountId(parseJwtPayload(token) ?? {}) : undefined;
}

function runtimeAccountId(headers: ProviderHeaders, apiKey?: string): string | undefined {
  const headerAccount = headerEntries(headers, "chatgpt-account-id")[0]?.[1];
  const authorization = headerEntries(headers, "authorization")[0]?.[1];
  const tokenAccount = accountIdFromToken(apiKey ?? bearerToken(authorization));
  return consistentAccountId(headerAccount, tokenAccount);
}

function runtimeAccessToken(headers: ProviderHeaders, apiKey?: string): string | undefined {
  return apiKey ?? bearerToken(headerEntries(headers, "authorization")[0]?.[1]);
}

export function codexAuthPath(options: CodexAuthPathOptions = {}): string {
  const configured = options.codexHome ?? process.env["CODEX_HOME"];
  const base = configured?.trim() ? resolve(configured) : join(options.home ?? homedir(), ".codex");
  return join(base, "auth.json");
}

async function readBoundedFile(path: string): Promise<string | undefined> {
  const handle = await open(path, "r");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_AUTH_FILE_BYTES) return undefined;
    while (total <= MAX_AUTH_FILE_BYTES) {
      const size = Math.min(READ_CHUNK_BYTES, MAX_AUTH_FILE_BYTES + 1 - total);
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(chunk, 0, size, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return total > MAX_AUTH_FILE_BYTES ? undefined : Buffer.concat(chunks, total).toString("utf8");
}

export async function readCodexCliCredential(
  options: ReadOptions = {},
): Promise<CredentialReadResult> {
  const path = options.path ?? codexAuthPath(options);
  let content: string | undefined;
  try {
    content = await readBoundedFile(path);
  } catch (error) {
    return {
      status: "unavailable",
      issue: errorCode(error) === "ENOENT" ? "missing" : "unreadable",
    };
  }
  if (content === undefined) return { status: "unavailable", issue: "malformed" };
  try {
    return parseCredential(JSON.parse(content) as unknown, options.now ?? Date.now());
  } catch {
    return { status: "unavailable", issue: "malformed" };
  }
}

export async function resolveCodexCliCredential(
  options: ResolveOptions,
): Promise<CredentialResolution> {
  const source = await readCodexCliCredential(options);
  if (source.status === "unavailable") return source;
  const accountId = runtimeAccountId(options.headers, options.apiKey);
  if (!accountId) return { status: "unavailable", issue: "runtime-account-unavailable" };
  if (accountId !== source.credential.accountId) {
    return { status: "unavailable", issue: "account-mismatch" };
  }
  if (runtimeAccessToken(options.headers, options.apiKey) === source.credential.accessToken) {
    return { status: "current", credential: source.credential };
  }
  return { status: "replace", credential: source.credential };
}
