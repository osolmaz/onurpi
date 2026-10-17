import { createHash } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineExtension,
  hook,
  ToolTask,
  type Harness,
} from "@earendil-works/pi-durable";

const context = BACKGROUND_CONTEXT;

/** `bash` commands that wait for the owner by default: pushes, merges, releases, deletes, publishes. */
export const DEFAULT_HELD_COMMANDS = [
  String.raw`\bgit\s+push\b`,
  String.raw`\bgh\s+(pr\s+merge|release\s+create|repo\s+delete)\b`,
  String.raw`\bnpm\s+publish\b`,
  String.raw`\brm\s+-[A-Za-z]*(r[A-Za-z]*f|f[A-Za-z]*r)`,
] as const;

export type ApprovalState = "pending" | "approved" | "rejected" | "used";

type ApprovalRecord = {
  conversationId: number;
  tool: string;
  command: string;
  fingerprint: string;
  state: ApprovalState;
};

/** Approval requests by number, committed with the conversations so they survive a restart. */
export const Approvals = defineDoc<{ next: number; requests: Record<string, ApprovalRecord> }>({
  initial: () => ({ next: 1, requests: {} }),
  kind: "agent-worker.approvals",
  scope: "session",
  version: 1,
});

export type ApprovalRequest = {
  readonly conversationId: number;
  readonly tool: string;
  readonly command: string;
  readonly fingerprint: string;
};

type Call = { readonly name: string; readonly arguments: unknown };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/** Identifies one exact call, so a grant covers only the call the owner saw. */
export function fingerprint(call: Call): string {
  return createHash("sha256")
    .update(`${call.name}\n${stable(call.arguments)}`)
    .digest("hex");
}

/** The command of a `bash` call that a rule holds, or undefined when the call may run. */
export function heldCommand(call: Call, rules: readonly RegExp[]): string | undefined {
  if (call.name !== "bash" || typeof call.arguments !== "object" || call.arguments === null)
    return undefined;
  const command: unknown = Reflect.get(call.arguments, "command");
  if (typeof command !== "string") return undefined;
  return rules.some((rule) => rule.test(command)) ? command : undefined;
}

export type ApprovalEvents = {
  /** A held call that has no request yet. */
  readonly requested: (request: ApprovalRequest) => void;
  /** An approved request whose call now runs. */
  readonly used: (id: string) => void;
};

/**
 * A Durable extension that holds matching tool calls until the owner approves them. A held call is
 * blocked, and the model is told to run the same call again after an approval. The owner's
 * decision is stored, so the hold and the grant survive a restart. This stops honest mistakes; it
 * is not a security limit, because the agent can change the worker that runs it.
 */
export function approvalsExtension(rules: readonly RegExp[], events: ApprovalEvents) {
  return defineExtension({
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, hookContext) => {
          const command = heldCommand(call, rules);
          if (command === undefined) return undefined;
          const print = fingerprint(call);
          const requests = Object.entries(
            (await api.snapshot(Approvals, hookContext))?.requests ?? {},
          );
          const granted = requests.find(
            ([, item]) => item.fingerprint === print && item.state === "approved",
          );
          if (granted !== undefined) {
            events.used(granted[0]);
            return undefined;
          }
          const waiting = requests.find(
            ([, item]) => item.fingerprint === print && item.state === "pending",
          );
          if (waiting === undefined) {
            events.requested({
              command,
              conversationId: api.conversationId,
              fingerprint: print,
              tool: call.name,
            });
          }
          const number = waiting === undefined ? "" : ` as request ${waiting[0]}`;
          return {
            block: `This call waits for the owner's approval${number}. The owner gets a card in Discord. When they approve it, you are told; then run exactly the same call again. Do not try another way to do it.`,
          };
        },
      }),
    ],
    name: "agent-worker-approvals",
  });
}

export type ApprovalStore = {
  /** Stores a new request and returns its number. */
  add(request: ApprovalRequest): Promise<string>;
  get(id: string): Promise<(ApprovalRequest & { readonly state: ApprovalState }) | undefined>;
  /** Moves a request to a new state. Returns false when the request does not exist or is no longer pending. */
  decide(id: string, state: Exclude<ApprovalState, "pending">): Promise<boolean>;
};

/** The approval records in the agent's storage. */
export function approvalStore(harness: Harness): ApprovalStore {
  return {
    add: (request) =>
      harness.commit(async (tx) => {
        const doc = await tx.doc(Approvals);
        const id = String(doc.next);
        doc.next += 1;
        doc.requests[id] = { ...request, state: "pending" };
        return id;
      }, context),
    decide: (id, state) =>
      harness.commit(async (tx) => {
        const record = (await tx.doc(Approvals)).requests[id];
        const allowed =
          state === "used" ? record?.state === "approved" : record?.state === "pending";
        if (record === undefined || !allowed) return false;
        record.state = state;
        return true;
      }, context),
    get: async (id) => (await harness.snapshot(Approvals, context))?.requests[id],
  };
}
