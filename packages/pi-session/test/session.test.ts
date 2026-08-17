import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { execute } from "../src/cli.js";
import {
  arrayValue,
  asRecord,
  booleanValue,
  loadSession,
  numberValue,
  resolveSessionPath,
  scanSessionFile,
  stringValue,
} from "../src/load.js";
import { renderRecoveryJson } from "../src/render-json.js";
import { renderRecoveryText } from "../src/render-text.js";
import { selectEntry, selectRecovery } from "../src/select.js";
import {
  INCLUDE_KINDS,
  TOTAL_OUTPUT_BYTES,
  type AssistantMode,
  type OutputFormat,
  type RecoveryOptions,
} from "../src/types.js";

const temporaryDirectories: string[] = [];
const timestamp = "2026-08-18T12:00:00.000Z";

function header(id = "019fd7b1-1111-7111-8111-111111111111", version = 3): object {
  return { type: "session", version, id, timestamp, cwd: "/fixture" };
}

function entry(id: string, parentId: string | null, message: object): object {
  return { type: "message", id, parentId, timestamp, message };
}

function user(id: string, parentId: string | null, content: unknown): object {
  return entry(id, parentId, { role: "user", content, timestamp: 1 });
}

function assistant(id: string, parentId: string | null, content: readonly object[]): object {
  return entry(id, parentId, {
    role: "assistant",
    content,
    provider: "test",
    model: "test",
    stopReason: "stop",
    timestamp: 2,
  });
}

function toolResult(
  id: string,
  parentId: string,
  callId: string,
  toolName: string,
  content: string,
  isError = false,
): object {
  return entry(id, parentId, {
    role: "toolResult",
    toolCallId: callId,
    toolName,
    content: [{ type: "text", text: content }],
    isError,
    timestamp: 3,
  });
}

function call(id: string, name: string, args: object): object {
  return { type: "toolCall", id, name, arguments: args };
}

async function fixture(lines: readonly (object | string)[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "fixture.jsonl");
  const text = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
  await writeFile(path, `${text}\n`, "utf8");
  return path;
}

function options(
  assistantMode: AssistantMode = "final",
  format: OutputFormat = "text",
): RecoveryOptions {
  return {
    last: 20,
    assistant: assistantMode,
    include: new Set(INCLUDE_KINDS),
    format,
    allProjects: false,
  };
}

function activeBranchFixture(): readonly object[] {
  return [
    header(),
    user("u0000001", null, "First request"),
    assistant("a0000001", "u0000001", [{ type: "text", text: "First response" }]),
    user("dead0001", "a0000001", "ABANDONED USER TEXT"),
    assistant("dead0002", "dead0001", [{ type: "text", text: "ABANDONED ASSISTANT TEXT" }]),
    user("u0000002", "a0000001", [
      { type: "text", text: "Active request Bearer top.secret" },
      { type: "image", mimeType: "image/png", data: "A".repeat(1_000) },
    ]),
    assistant("a0000002", "u0000002", [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "I will update the plan." },
      call("plan-call", "update_plan", {
        explanation: "Observed plan",
        plan: [{ step: "Implement", status: "in_progress" }],
      }),
    ]),
    toolResult("r0000001", "a0000002", "plan-call", "update_plan", "Plan updated"),
    assistant("a0000003", "r0000001", [
      call("workflow-call", "workflow", {
        action: "start",
        workflow: "monitor",
        input: { task: "safe" },
      }),
    ]),
    toolResult("r0000002", "a0000003", "workflow-call", "workflow", '{"runId":"run-1"}'),
    assistant("a0000004", "r0000002", [
      call("edit-call", "functions.edit", {
        path: "/fixture/src/file.ts",
        oldText: "a",
        newText: "b",
      }),
    ]),
    toolResult("r0000003", "a0000004", "edit-call", "functions.edit", "edited"),
    assistant("a0000004b", "r0000003", [
      call("write-call", "write", { path: "/fixture/src/new.ts", content: "secret body" }),
    ]),
    toolResult("r0000003b", "a0000004b", "write-call", "write", "written"),
    assistant("a0000005", "r0000003b", [call("exec-call", "exec_command", { cmd: "false" })]),
    toolResult("r0000004", "a0000005", "exec-call", "exec_command", "command failed", true),
    assistant("a0000006", "r0000004", [
      { type: "thinking", thinking: "reasoning must stay hidden" },
      { type: "thinkingSignature", signature: "signature must stay hidden" },
      { type: "text", text: "Final visible response" },
    ]),
    user("u0000003", "a0000006", "Interrupted request"),
    assistant("a0000007", "u0000003", [call("unfinished", "exec_command", { cmd: "sleep" })]),
  ];
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true });
    }),
  );
});

describe("active branch recovery", () => {
  it("uses Pi branch semantics and selects only final user-visible responses", async () => {
    const path = await fixture(activeBranchFixture());
    const loaded = await loadSession(path);
    const document = selectRecovery(loaded, options());

    expect(document.session.entries).toBe(18);
    expect(document.session.activeBranchEntries).toBe(16);
    expect(document.turns).toHaveLength(3);
    expect(document.turns[1]?.assistant.messages.map((message) => message.text.text)).toEqual([
      "Final visible response",
    ]);
    expect(document.turns[2]?.assistant).toEqual({ status: "interrupted", messages: [] });

    const text = renderRecoveryText(document);
    expect(text).toContain("First request");
    expect(text).toContain("Final visible response");
    expect(text).toContain("[No final response: turn was interrupted]");
    expect(text).not.toContain("ABANDONED USER TEXT");
    expect(text).not.toContain("ABANDONED ASSISTANT TEXT");
    expect(text).not.toContain("private reasoning");
    expect(text).not.toContain("signature must stay hidden");
    expect(text).not.toContain("top.secret");
    expect(text).not.toContain("A".repeat(100));
  });

  it("labels intermediate text and preserves bounded control evidence", async () => {
    const path = await fixture(activeBranchFixture());
    const loaded = await loadSession(path);
    const document = selectRecovery(loaded, options("text"));
    const turn = document.turns[1];

    expect(turn?.assistant.messages.map((message) => message.kind)).toEqual([
      "intermediate",
      "final",
    ]);
    expect(turn?.control.map((event) => `${event.kind}:${event.phase}`)).toEqual([
      "plan:call",
      "workflow:call",
      "workflow:result",
      "files:call",
      "files:call",
      "errors:result",
    ]);
    expect(
      turn?.control.filter((event) => event.kind === "files").map((event) => event.text.text),
    ).toEqual(["/fixture/src/file.ts", "/fixture/src/new.ts"]);
    expect(turn?.control.find((event) => event.kind === "errors")?.text.text).toBe(
      "command failed",
    );
    expect(turn?.user.text.omissions).toContain("image omitted (image/png)");
    expect(turn?.user.text.redactions).toBe(1);
  });

  it("applies --since and --last without inferring conclusions", async () => {
    const path = await fixture(activeBranchFixture());
    const loaded = await loadSession(path);
    const byEntry = selectRecovery(loaded, { ...options(), since: "r0000002", last: 20 });
    const byLast = selectRecovery(loaded, { ...options(), last: 1 });
    expect(byEntry.turns.map((turn) => turn.number)).toEqual([2, 3]);
    expect(byLast.turns.map((turn) => turn.number)).toEqual([3]);
    expect(byLast.nextOffset).toBe(2);
    expect(() => selectRecovery(loaded, { ...options(), since: "not-a-date-or-id" })).toThrow(
      "--since is not",
    );
  });
});

describe("integrity and read-only loading", () => {
  it("reports malformed records, duplicate ids, missing parents, and cycles", async () => {
    const malformedPath = await fixture([
      header(),
      "{bad",
      user("u1", null, "ok"),
      assistant("empty", "u1", []),
    ]);
    const duplicatePath = await fixture([
      header("019fd7b1-2222-7222-8222-222222222222"),
      user("same", null, "one"),
      user("same", "same", "two"),
    ]);
    const missingPath = await fixture([
      header("019fd7b1-3333-7333-8333-333333333333"),
      user("orphan", "absent", "orphan"),
    ]);
    const cyclePath = await fixture([
      header("019fd7b1-4444-7444-8444-444444444444"),
      user("cycle1", "cycle2", "one"),
      user("cycle2", "cycle1", "two"),
    ]);

    const malformed = await loadSession(malformedPath);
    expect(malformed.integrity.issues.map((item) => item.code)).toContain("malformed_jsonl");
    expect(malformed.integrity.issues.map((item) => item.code)).toContain(
      "empty_assistant_message",
    );
    const duplicate = await loadSession(duplicatePath);
    expect(duplicate.integrity.issues.map((item) => item.code)).toContain("duplicate_entry_id");
    expect(duplicate.branch).toEqual([]);
    expect((await loadSession(missingPath)).integrity.issues.map((item) => item.code)).toContain(
      "missing_parent",
    );
    const cycle = await loadSession(cyclePath);
    expect(cycle.integrity.issues.map((item) => item.code)).toContain("parent_cycle");
    expect(cycle.branch).toEqual([]);
  });

  it("reports invalid headers, versions, roots, pairs, and bounded scan omissions", async () => {
    const invalidHeader = await fixture(["null", user("u1", null, "ignored")]);
    const futureHeader = await fixture([
      { type: "session", version: 4, timestamp, cwd: "/fixture" },
    ]);
    const multipleRoots = await fixture([
      header("019fd7b1-aaaa-7aaa-8aaa-aaaaaaaaaaaa"),
      user("root1", null, "one"),
      toolResult("root2", "root1", "unknown-call", "unknown", "result"),
      user("root3", null, "three"),
    ]);
    const malformed = await fixture([
      header("019fd7b1-bbbb-7bbb-8bbb-bbbbbbbbbbbb"),
      ...Array.from({ length: 25 }, () => "{bad"),
      user("valid", null, "valid"),
    ]);

    expect((await loadSession(invalidHeader)).integrity.issues.map((item) => item.code)).toContain(
      "invalid_header",
    );
    const future = await loadSession(futureHeader);
    expect(future.integrity.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["invalid_session_id", "unsupported_session_version"]),
    );
    const roots = await loadSession(multipleRoots);
    expect(roots.integrity.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["multiple_roots", "missing_tool_call"]),
    );
    const scanned = await scanSessionFile(malformed);
    expect(scanned.malformedLineCount).toBe(25);
    expect((await loadSession(malformed)).integrity.issues.map((item) => item.code)).toContain(
      "malformed_jsonl_omitted",
    );
  });

  it("validates unknown values before using session data", () => {
    expect(asRecord({ key: "value" })).toEqual({ key: "value" });
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord([])).toBeUndefined();
    expect(stringValue("text")).toBe("text");
    expect(stringValue(1)).toBeUndefined();
    expect(numberValue(3)).toBe(3);
    expect(numberValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(booleanValue(false)).toBe(false);
    expect(booleanValue("false")).toBeUndefined();
    expect(arrayValue([1])).toEqual([1]);
    expect(arrayValue("1")).toBeUndefined();
  });

  it("does not open or migrate a legacy session", async () => {
    const path = await fixture([
      header("019fd7b1-5555-7555-8555-555555555555", 2),
      user("u1", null, "legacy"),
    ]);
    const before = await readFile(path);
    const loaded = await loadSession(path);
    const after = await readFile(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.integrity.issues.map((item) => item.code)).toContain("legacy_session_version");
    expect(after).toEqual(before);
  });

  it("leaves a current session byte-for-byte and timestamp unchanged", async () => {
    const path = await fixture(activeBranchFixture());
    const fixed = new Date("2020-01-01T00:00:00.000Z");
    await utimes(path, fixed, fixed);
    const beforeBytes = await readFile(path);
    const beforeStat = await stat(path);
    const beforeHash = createHash("sha256").update(beforeBytes).digest("hex");

    await loadSession(path);

    const afterBytes = await readFile(path);
    const afterStat = await stat(path);
    expect(createHash("sha256").update(afterBytes).digest("hex")).toBe(beforeHash);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });
});

describe("bounded output and forensic entry views", () => {
  it("contains a 5.4 MB tool result without emitting its body", async () => {
    const huge = "large-result-marker\n".repeat(270_001);
    expect(Buffer.byteLength(huge)).toBeGreaterThan(5_400_000);
    const path = await fixture([
      header("019fd7b1-6666-7666-8666-666666666666"),
      user("u1", null, "Run the tool"),
      assistant("a1", "u1", [call("huge-call", "exec_command", { cmd: "large" })]),
      toolResult("r1", "a1", "huge-call", "exec_command", huge),
      assistant("a2", "r1", [{ type: "text", text: "Finished safely" }]),
    ]);
    const scan = await scanSessionFile(path);
    expect(scan.oversizedLineCount).toBe(1);
    const loaded = await loadSession(path);
    const document = selectRecovery(loaded, options());
    const text = renderRecoveryText(document);
    const json = renderRecoveryJson(document);

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(TOTAL_OUTPUT_BYTES);
    expect(() => JSON.parse(json) as unknown).not.toThrow();
    expect(text).toContain("oversized_tool_result");
    expect(text).not.toContain("large-result-marker");
    expect(json).not.toContain("large-result-marker");
    expect(renderRecoveryJson(document)).toBe(json);
    expect(renderRecoveryText(document)).toBe(text);
  });

  it("omits custom metadata and normal tool bodies from entry inspection", async () => {
    const path = await fixture([
      header("019fd7b1-7777-7777-8777-777777777777"),
      user("u1", null, "request"),
      {
        type: "custom",
        id: "custom1",
        parentId: "u1",
        timestamp,
        customType: "secret-state",
        data: { token: "must-not-appear" },
      },
      assistant("a1", "custom1", [call("c1", "exec_command", { cmd: "echo" })]),
      toolResult("r1", "a1", "c1", "exec_command", "raw-tool-body-must-not-appear"),
    ]);
    const loaded = await loadSession(path);
    const custom = selectEntry(loaded, "custom1");
    const result = selectEntry(loaded, "r1");
    expect(custom.entry?.summary.text).toContain("metadata omitted");
    expect(JSON.stringify(custom)).not.toContain("must-not-appear");
    expect(result.entry?.summary.text).toContain("body omitted");
    expect(JSON.stringify(result)).not.toContain("raw-tool-body-must-not-appear");
    expect(selectEntry(loaded, "absent").entry).toBeNull();
  });
});

describe("CLI discovery and rendering", () => {
  it("resolves a unique UUID prefix in cwd and rejects broad or ambiguous lookup", async () => {
    const path = await fixture([header(), user("u1", null, "request")]);
    const otherPath = await fixture([
      header("019fd7b1-9999-7999-8999-999999999999"),
      user("u2", null, "other"),
    ]);
    const info = sessionInfo(path, "019fd7b1-1111-7111-8111-111111111111");
    const listSpy = vi.spyOn(SessionManager, "list").mockResolvedValue([info]);
    expect(await resolveSessionPath("019fd7b1", "/fixture", false)).toBe(path);
    listSpy.mockResolvedValue([
      info,
      sessionInfo(otherPath, "019fd7b1-9999-7999-8999-999999999999"),
    ]);
    await expect(resolveSessionPath("019fd7b1", "/fixture", false)).rejects.toThrow("ambiguous");
    await expect(resolveSessionPath("relative/path.jsonl", "/fixture", false)).rejects.toThrow(
      "absolute path",
    );
  });

  it("uses explicit all-project discovery and reports no match", async () => {
    const path = await fixture([header(), user("u1", null, "request")]);
    const listAllSpy = vi
      .spyOn(SessionManager, "listAll")
      .mockResolvedValue([sessionInfo(path, "019fd7b1-1111-7111-8111-111111111111")]);
    expect(await resolveSessionPath("019fd7b1", "/fixture", true)).toBe(path);
    listAllSpy.mockResolvedValue([]);
    await expect(resolveSessionPath("019fd7b1", "/fixture", true)).rejects.toThrow("all projects");
  });

  it("renders real absolute-path show, entry, list, JSON, and help commands", async () => {
    const path = await fixture(activeBranchFixture());
    const show = await execute([path]);
    const json = await execute([path, "--format", "json"]);
    const entryOutput = await execute(["entry", path, "u0000002", "--format", "json"]);
    vi.spyOn(SessionManager, "list").mockResolvedValue([
      {
        ...sessionInfo(path, "019fd7b1-1111-7111-8111-111111111111"),
        name: "api_key=must-not-appear",
      },
    ]);
    const list = await execute(["list", "--format", "json"], "/fixture");
    const help = await execute(["--help"]);

    expect(show).toContain("Session:");
    expect(JSON.parse(json)).toMatchObject({ schema: "pi-session/v1" });
    expect(JSON.parse(entryOutput)).toMatchObject({ entry: { id: "u0000002" } });
    expect(JSON.parse(list)).toMatchObject({
      scope: "cwd",
      sessions: [{ path, name: 'api_key="<redacted>"' }],
    });
    expect(list).not.toContain("must-not-appear");
    expect(help).toContain("bounded, read-only evidence");
  });
});

function sessionInfo(path: string, id: string): SessionInfo {
  return {
    path,
    id,
    cwd: "/fixture",
    created: new Date(timestamp),
    modified: new Date(timestamp),
    messageCount: 1,
    firstMessage: "first",
    allMessagesText: "first",
  };
}
