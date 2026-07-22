import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { replayPlanSnapshot } from "./plan-replay.ts";

function toolResult(
  id: string,
  details: unknown,
  options: { error?: boolean; toolName?: string; timestamp?: number } = {},
): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(options.timestamp ?? 100).toISOString(),
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      toolName: options.toolName ?? "update_plan",
      content: [{ type: "text", text: "Plan updated" }],
      details,
      isError: options.error ?? false,
      timestamp: options.timestamp ?? 100,
    },
  };
}

describe("replayPlanSnapshot", () => {
  it("uses the latest successful valid snapshot in branch order", () => {
    const replayed = replayPlanSnapshot([
      toolResult(
        "first",
        { plan: [{ step: "Inspect", status: "in_progress" }] },
        { timestamp: 10 },
      ),
      toolResult("other", { plan: [{ step: "Ignore", status: "pending" }] }, { toolName: "todo" }),
      toolResult("failed", { plan: [{ step: "Ignore", status: "pending" }] }, { error: true }),
      toolResult("bad", { plan: [{ step: " Invalid ", status: "pending" }] }),
      toolResult(
        "latest",
        {
          plan: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "in_progress" },
          ],
        },
        { timestamp: 50 },
      ),
    ]);

    expect(replayed).toEqual({
      snapshot: {
        plan: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "in_progress" },
        ],
      },
      sourceTimestamp: 50,
    });
  });

  it("lets an empty successful snapshot clear prior state", () => {
    expect(
      replayPlanSnapshot([
        toolResult("first", { plan: [{ step: "Inspect", status: "pending" }] }),
        toolResult("clear", { plan: [] }),
      ]),
    ).toEqual({ snapshot: undefined, sourceTimestamp: undefined });
  });

  it("returns no state for a branch without a valid plan result", () => {
    const nonMessage: SessionEntry = {
      type: "custom",
      id: "custom",
      parentId: null,
      timestamp: new Date(0).toISOString(),
      customType: "other",
    };
    expect(replayPlanSnapshot([nonMessage, toolResult("bad", { plan: "invalid" })])).toEqual({
      snapshot: undefined,
      sourceTimestamp: undefined,
    });
  });

  it("follows real SessionManager branches and ignores compaction for replay", () => {
    const session = SessionManager.inMemory("/tmp/plan-checklist-test");
    const firstId = session.appendMessage({
      role: "toolResult",
      toolCallId: "first",
      toolName: "update_plan",
      content: [{ type: "text", text: "Plan updated" }],
      details: { plan: [{ step: "First branch", status: "in_progress" }] },
      isError: false,
      timestamp: 10,
    });
    session.appendCompaction("summary", firstId, 100);
    expect(replayPlanSnapshot(session.getBranch()).snapshot?.plan[0]?.step).toBe("First branch");

    session.branch(firstId);
    session.appendMessage({
      role: "toolResult",
      toolCallId: "second",
      toolName: "update_plan",
      content: [{ type: "text", text: "Plan updated" }],
      details: { plan: [{ step: "Second branch", status: "pending" }] },
      isError: false,
      timestamp: 20,
    });
    expect(replayPlanSnapshot(session.getBranch()).snapshot?.plan[0]?.step).toBe("Second branch");

    session.branch(firstId);
    expect(replayPlanSnapshot(session.getBranch()).snapshot?.plan[0]?.step).toBe("First branch");
  });
});
