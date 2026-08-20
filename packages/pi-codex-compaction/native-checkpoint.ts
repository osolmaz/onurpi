import type { Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCodexFamilyModel } from "@onurpi/codex-switcher";

export const NATIVE_COMPACTION_KIND = "openai-codex-native-compaction";
export const NATIVE_COMPACTION_VERSION = 1;

export type JsonObject = Record<string, unknown>;
export type ResponseItem = JsonObject & { type?: string };

/** The only model family this extension serves: built-in Codex and switcher profile providers. */
export type CodexModel = Model<"openai-codex-responses">;

export type NativeCompactionDetails = {
  kind: typeof NATIVE_COMPACTION_KIND;
  version: typeof NATIVE_COMPACTION_VERSION;
  modelKey: string;
  replacementHistory: ResponseItem[];
};

export type NativeCheckpoint = {
  entryIndex: number;
  entryId: string;
  details: NativeCompactionDetails;
};

export type CheckpointLookup =
  | { status: "none" }
  | { status: "invalid"; entryIndex: number; entryId: string }
  | { status: "valid"; checkpoint: NativeCheckpoint };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOpenAICodexModel(model: unknown): model is CodexModel {
  if (!isJsonObject(model)) return false;
  const provider = model["provider"];
  const api = model["api"];
  return (
    typeof provider === "string" && typeof api === "string" && isCodexFamilyModel({ provider, api })
  );
}

export function modelKey(model: { provider: string; api: string; id: string }): string {
  const provider = isCodexFamilyModel(model) ? "openai-codex" : model.provider;
  return `${provider}:${model.api}:${model.id}`;
}

function isResponseItem(value: unknown): value is ResponseItem {
  if (!isJsonObject(value)) return false;
  return (
    typeof value["type"] === "string" ||
    (typeof value["role"] === "string" &&
      (typeof value["content"] === "string" || Array.isArray(value["content"])))
  );
}

function hasValidCompactionItem(history: ResponseItem[]): boolean {
  const compactionItems = history.filter((item) => item.type === "compaction");
  const last = history.at(-1);
  return (
    compactionItems.length === 1 &&
    typeof compactionItems[0]?.["encrypted_content"] === "string" &&
    last?.type === "compaction"
  );
}

function parseReplacementHistory(value: JsonObject): ResponseItem[] | undefined {
  const raw = value["replacementHistory"];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const history = raw.filter(isResponseItem);
  if (history.length !== raw.length || !hasValidCompactionItem(history)) return undefined;
  return history.map((item) => structuredClone(item));
}

export function parseNativeCompactionDetails(value: unknown): NativeCompactionDetails | undefined {
  if (!isJsonObject(value)) return undefined;
  if (value["kind"] !== NATIVE_COMPACTION_KIND) return undefined;
  if (value["version"] !== NATIVE_COMPACTION_VERSION) return undefined;
  const modelKey = value["modelKey"];
  if (typeof modelKey !== "string") return undefined;
  const replacementHistory = parseReplacementHistory(value);
  if (!replacementHistory) return undefined;
  return {
    kind: NATIVE_COMPACTION_KIND,
    version: NATIVE_COMPACTION_VERSION,
    modelKey,
    replacementHistory,
  };
}

/**
 * Find the newest native checkpoint on the active branch.
 *
 * A checkpoint may live in a real compaction entry (current behavior) or in a legacy custom entry
 * (pre-boundary upstream versions). The newest compaction-like entry decides: a plain Pi text
 * compaction means "none", and a malformed native payload means "invalid" so callers fail closed.
 */
/** Raw native details payload, or null for "keep scanning older entries". */
function rawCheckpointDetails(entry: SessionEntry): { found: boolean; raw?: unknown } {
  if (entry.type === "compaction") {
    if (!isJsonObject(entry.details) || entry.details["kind"] !== NATIVE_COMPACTION_KIND) {
      return { found: true, raw: undefined };
    }
    return { found: true, raw: entry.details };
  }
  if (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_KIND) {
    return { found: true, raw: entry.data };
  }
  return { found: false };
}

export function findNativeCheckpoint(branch: SessionEntry[]): CheckpointLookup {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (!entry) continue;
    const candidate = rawCheckpointDetails(entry);
    if (!candidate.found) continue;
    if (candidate.raw === undefined) return { status: "none" };
    const details = parseNativeCompactionDetails(candidate.raw);
    if (!details) return { status: "invalid", entryIndex: index, entryId: entry.id };
    return { status: "valid", checkpoint: { entryIndex: index, entryId: entry.id, details } };
  }
  return { status: "none" };
}
