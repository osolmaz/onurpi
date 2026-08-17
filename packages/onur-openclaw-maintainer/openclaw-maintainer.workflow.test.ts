import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkflowEngine,
  validateWorkflowDefinition,
  type AgentStepExecutor,
  type AgentStepRequest,
  type AgentStepSubmission,
} from "@onurpi/workflows";

import { buildWorkflowInput, parseIssueReference } from "./maintainer.ts";
import workflow, {
  readInput,
  validateInspection,
  validateProof,
  validateRecommendation,
} from "./openclaw-maintainer.workflow.ts";

const inspection = {
  issueTitle: "Compaction frees zero tokens",
  plainProblem: "Compaction keeps everything and therefore frees no space.",
  stillApplies: "yes",
  implicatedFiles: ["packages/agent-core/src/harness/compaction/compaction.ts"],
  relatedRefs: [],
  sourceEvidence: ["The cut point falls back to the first entry."],
};

const proof = {
  proofType: "synthetic",
  reproduced: "yes",
  commands: ["node /tmp/repro.mjs"],
  observations: ["messagesToSummarize was empty"],
  rootCause: "Trigger and cut-point estimates use incompatible units.",
  confidence: "high",
  workingTreeClean: true,
};

const recommendation = {
  route: "actionable",
  solutionScope: "general",
  recommendedChange: "Use compatible accounting and reject a non-advancing compaction.",
  invariants: ["Keep assistant tool calls paired with their results."],
  tests: ["Add a regression for a high provider usage and low transcript estimate."],
  risks: ["Split-turn behavior must remain valid."],
  nextHumanDecision: "Choose the exact accounting strategy before implementation.",
  mergeRecommended: false,
};

class MaintainerExecutor implements AgentStepExecutor {
  readonly requests: AgentStepRequest[] = [];

  async runAgentStep(request: AgentStepRequest): Promise<AgentStepSubmission> {
    this.requests.push(request);
    const output =
      request.contract.nodeId === "inspect_issue"
        ? inspection
        : request.contract.nodeId === "prove_issue"
          ? proof
          : recommendation;
    const accepted = await request.accept(output);
    if (!accepted.ok) throw new Error(accepted.error);
    return { output: accepted.value };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenClaw maintainer workflow", () => {
  it("is a valid bounded graph", () => {
    expect(() => {
      validateWorkflowDefinition(workflow);
    }).not.toThrow();
    expect(workflow.name).toBe("onur-openclaw-maintainer");
    expect(workflow.maxSteps).toBe(8);
    expect(Object.keys(workflow.nodes)).toEqual([
      "inspect_issue",
      "prove_issue",
      "recommend_solution",
      "finalize",
    ]);
  });

  it("runs to a structured no-merge result", async () => {
    const issue = parseIssueReference("111886");
    if (!issue) throw new Error("test issue did not parse");
    const input = buildWorkflowInput(issue);
    const outputRoot = await mkdtemp(join(tmpdir(), "openclaw-maintainer-runs-"));
    vi.stubEnv("PI_WORKFLOWS_RUNS_DIR", outputRoot);
    const executor = new MaintainerExecutor();
    const result = await new WorkflowEngine({ executor, outputRoot }).run(workflow, input);

    expect(result.state.status).toBe("completed");
    expect(result.state.finalOutput).toEqual({
      workflowTest: true,
      merged: false,
      githubChanged: false,
      issue: {
        number: 111886,
        url: "https://github.com/openclaw/openclaw/issues/111886",
      },
      inspection,
      proof,
      recommendation,
      note: "This is a workflow test. Do not merge automatically.",
    });
    expect(executor.requests).toHaveLength(3);
    for (const request of executor.requests) {
      expect(request.prompt).toContain("This is a test of the maintainer workflow.");
      expect(request.prompt).toContain("Do not create commits");
    }
    expect(executor.requests[0]?.prompt).toContain("Do not run reproductions or tests");
    expect(executor.requests[1]?.prompt).toContain("full literal command");
    expect(executor.requests[1]?.prompt).toContain("Never use ellipses");
  });

  it("rejects writable or malformed input", () => {
    const issue = parseIssueReference("111886");
    if (!issue) throw new Error("test issue did not parse");
    const input = buildWorkflowInput(issue);
    expect(readInput(input)).toEqual(input);
    expect(() => readInput({ ...input, allowMerge: true })).toThrow(/read-only/);
    expect(() => readInput({ ...input, issueUrl: "https://example.com" })).toThrow(/read-only/);
  });

  it("rejects malformed inspection output", () => {
    expect(() => validateInspection(null)).toThrow(/must be an object/);
    expect(() => validateInspection({ ...inspection, issueTitle: "" })).toThrow(/non-empty/);
    expect(() => validateInspection({ ...inspection, stillApplies: "maybe" })).toThrow(/one of/);
    expect(() => validateInspection({ ...inspection, implicatedFiles: "path" })).toThrow(/array/);
    expect(() => validateInspection({ ...inspection, relatedRefs: [1] })).toThrow(/array/);
  });

  it("rejects malformed proof and recommendations", () => {
    expect(() => validateProof({ ...proof, proofType: "guess" })).toThrow(/one of/);
    expect(() => validateProof({ ...proof, rootCause: "" })).toThrow(/non-empty/);
    expect(() => validateProof({ ...proof, commands: ["node ... synthetic proof"] })).toThrow(
      /exact commands without elisions/,
    );
    expect(() => validateProof({ ...proof, workingTreeClean: false })).toThrow(/must be true/);
    expect(() => validateRecommendation({ ...recommendation, route: "merge" })).toThrow(/one of/);
    expect(() => validateRecommendation({ ...recommendation, mergeRecommended: true })).toThrow(
      /must be false/,
    );
  });
});
