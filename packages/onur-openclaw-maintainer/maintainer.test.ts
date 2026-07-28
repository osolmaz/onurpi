import { describe, expect, it, vi } from "vitest";

import {
  WORKFLOW_START_CHANNEL,
  WORKFLOW_START_RESULT_CHANNEL,
  buildWorkflowInput,
  fetchInventory,
  formatIssueChoice,
  isForbiddenMaintainerCommand,
  parseInventory,
  parseIssueReference,
  requestWorkflowStart,
  type SharedEventBus,
  type WorkflowStartRequest,
} from "./maintainer.ts";

class TestBus implements SharedEventBus {
  readonly emitted: { channel: string; data: unknown }[] = [];
  private readonly handlers = new Map<string, ((data: unknown) => void)[]>();

  emit(channel: string, data: unknown): void {
    this.emitted.push({ channel, data });
    for (const handler of this.handlers.get(channel) ?? []) handler(data);
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const handlers = this.handlers.get(channel) ?? [];
    handlers.push(handler);
    this.handlers.set(channel, handlers);
    return () => {
      this.handlers.set(
        channel,
        (this.handlers.get(channel) ?? []).filter((candidate) => candidate !== handler),
      );
    };
  }
}

function requireIssue(reference: string) {
  const issue = parseIssueReference(reference);
  if (!issue) throw new Error(`test issue did not parse: ${reference}`);
  return issue;
}

describe("OpenClaw maintainer inputs", () => {
  it.each([
    ["111886", 111886],
    ["#111886", 111886],
    ["https://github.com/openclaw/openclaw/issues/111886", 111886],
    ["https://github.com/openclaw/openclaw/issues/111886/", 111886],
  ])("parses %s", (reference, number) => {
    expect(parseIssueReference(reference)).toMatchObject({ number });
  });

  it.each([
    "",
    "0",
    "-1",
    "openclaw/openclaw#111886",
    "https://github.com/openclaw/openclaw/pull/111886",
    "https://github.com/other/repo/issues/111886",
  ])("rejects invalid reference %s", (reference) => {
    expect(parseIssueReference(reference)).toBeUndefined();
  });

  it("builds an explicit test-only, no-merge workflow contract", () => {
    expect(buildWorkflowInput(requireIssue("111886"))).toEqual({
      allowCommits: false,
      allowGitHubWrites: false,
      allowMerge: false,
      allowTrackedChanges: false,
      issueNumber: 111886,
      issueUrl: "https://github.com/openclaw/openclaw/issues/111886",
      operatorNote: "This is a workflow test. Do not merge automatically.",
      repository: "openclaw/openclaw",
      workflowTest: true,
    });
  });
});

describe("curated issue inventory", () => {
  const inventory = {
    open_threads: [
      {
        activity: 3,
        area: "Model routing/config",
        number: 111886,
        title: "Compaction frees zero tokens",
        type: "issue",
        url: "https://github.com/openclaw/openclaw/issues/111886",
      },
      {
        activity: 8,
        area: "Local runtime",
        number: 111900,
        title: "Local runtime issue",
        type: "issue",
        url: "https://github.com/openclaw/openclaw/issues/111900",
      },
      {
        activity: 100,
        area: "Local runtime",
        number: 111901,
        title: "A pull request",
        type: "pull_request",
        url: "https://github.com/openclaw/openclaw/pull/111901",
      },
      {
        activity: -1,
        area: "Bad",
        number: 2,
        title: "Invalid",
        type: "issue",
        url: "https://github.com/openclaw/openclaw/issues/2",
      },
    ],
  };

  it("keeps valid issues and sorts by activity", () => {
    const issues = parseInventory(inventory);
    expect(issues.map((issue) => issue.number)).toEqual([111900, 111886]);
    const second = issues[1];
    if (!second) throw new Error("missing second issue");
    expect(formatIssueChoice(second)).toBe(
      "#111886 · Model routing/config · Compaction frees zero tokens",
    );
  });

  it("fetches and validates the bounded inventory", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(inventory), {
          status: 200,
          headers: { "content-length": "1000" },
        }),
      ),
    );
    await expect(fetchInventory(fetcher)).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects missing or empty issue lists", () => {
    expect(() => parseInventory({})).toThrow(/open_threads/);
    expect(() => parseInventory({ open_threads: [] })).toThrow(/no open issues/);
  });

  it("rejects failed and oversized responses", async () => {
    await expect(
      fetchInventory(() => Promise.resolve(new Response("no", { status: 503 }))),
    ).rejects.toThrow(/HTTP 503/);
    await expect(
      fetchInventory(() =>
        Promise.resolve(
          new Response("{}", { status: 200, headers: { "content-length": "2000001" } }),
        ),
      ),
    ).rejects.toThrow(/too large/);
  });
});

describe("workflow start bridge", () => {
  it("correlates the start result", async () => {
    const bus = new TestBus();
    bus.on(WORKFLOW_START_CHANNEL, (value) => {
      const request = value as WorkflowStartRequest;
      bus.emit(WORKFLOW_START_RESULT_CHANNEL, {
        requestId: request.requestId,
        ok: true,
        workflowName: "onur-openclaw-maintainer",
      });
    });
    await expect(
      requestWorkflowStart({
        bus,
        input: buildWorkflowInput(requireIssue("111886")),
        ref: "/tmp/workflow.ts",
        requestId: "request-1",
      }),
    ).resolves.toEqual({
      requestId: "request-1",
      ok: true,
      workflowName: "onur-openclaw-maintainer",
    });
    expect(bus.emitted[0]?.channel).toBe(WORKFLOW_START_CHANNEL);
  });

  it("times out when pi-workflows is unavailable", async () => {
    const bus = new TestBus();
    const result = await requestWorkflowStart({
      bus,
      input: buildWorkflowInput(requireIssue("111886")),
      ref: "/tmp/workflow.ts",
      requestId: "request-2",
      timeoutMs: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected start failure");
    expect(result.error).toContain("pi-workflows");
  });
});

describe("read-only command policy", () => {
  it.each([
    "git commit -am test",
    "git push origin main",
    "git merge feature",
    "gh issue comment 111886 --body hi",
    "gh issue close 111886",
    "gh pr create --fill",
    "gh pr merge 123 --squash",
    "gh api repos/openclaw/openclaw/issues/111886 -X PATCH -f state=closed",
  ])("blocks %s", (command) => {
    expect(isForbiddenMaintainerCommand(command)).toBe(true);
  });

  it.each([
    "git status --short",
    "git diff --check",
    "gh issue view 111886 --repo openclaw/openclaw",
    "gh api repos/openclaw/openclaw/issues/111886",
    "node scripts/run-vitest.mjs packages/agent-core/src/harness/compaction/compaction.test.ts",
  ])("allows %s", (command) => {
    expect(isForbiddenMaintainerCommand(command)).toBe(false);
  });
});
