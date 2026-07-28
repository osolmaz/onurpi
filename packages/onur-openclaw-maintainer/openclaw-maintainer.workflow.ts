import { agent, compute, defineWorkflow } from "pi-workflows";

import type { MaintainerWorkflowInput } from "./maintainer.ts";

const NO_WRITE_RULES = [
  "This is a test of the maintainer workflow.",
  "Keep GitHub and tracked files unchanged.",
  "Do not create commits, push branches, open or edit pull requests, post comments, close issues, or merge anything.",
  "Use temporary files outside the repository if a focused reproduction needs generated data.",
  "Do not call another coding agent. Perform the investigation in this Pi session.",
] as const;

export default defineWorkflow({
  name: "onur-openclaw-maintainer",
  title: ({ input }) => {
    const issue = readInput(input);
    return `OpenClaw #${String(issue.issueNumber)} maintainer workflow test`;
  },
  presentationPrompt: ({ finalOutput }) =>
    [
      "Present the maintainer triage result in plain language.",
      "Start by saying this was a workflow test and that nothing was merged or written to GitHub.",
      "State whether the issue reproduces or is otherwise proven, the root cause, whether the right fix is local or general, and the next human decision.",
      "Do not claim tests ran unless the recorded proof says they ran.",
      `Structured result: ${JSON.stringify(finalOutput)}`,
    ].join("\n"),
  maxSteps: 8,
  startAt: "inspect_issue",
  nodes: {
    inspect_issue: agent({
      timeoutMs: 30 * 60_000,
      statusDetail: "inspecting issue",
      prompt: ({ input }) => {
        const issue = readInput(input);
        return [
          ...NO_WRITE_RULES,
          "",
          `Investigate ${issue.issueUrl} in the current OpenClaw checkout.`,
          "Read the live issue, its maintainer comments, repository instructions, current compaction implementation, focused tests, and relevant recent history.",
          "Keep this inspection bounded. Do not run reproductions or tests in this step; the next step owns proof.",
          "Check whether current main still has the reported behavior. Distinguish the reporter's proposed fix from the verified root cause.",
          "Explain the failure plainly, identify related issues or pull requests only when there is evidence, and submit once the source evidence is sufficient.",
        ].join("\n");
      },
      expectedOutput: [
        "{",
        '  "issueTitle": "live issue title",',
        '  "plainProblem": "short plain-language explanation",',
        '  "stillApplies": "yes" | "no" | "unclear",',
        '  "implicatedFiles": ["path"],',
        '  "relatedRefs": ["full GitHub URL"],',
        '  "sourceEvidence": ["specific observation"]',
        "}",
      ].join("\n"),
      validate: validateInspection,
    }),
    prove_issue: agent({
      timeoutMs: 45 * 60_000,
      statusDetail: "proving issue",
      prompt: ({ input, outputs }) => {
        const issue = readInput(input);
        return [
          ...NO_WRITE_RULES,
          "",
          `Prove or disprove ${issue.issueUrl} against the current checkout.`,
          "Use the cheapest honest path first: focused existing test, temporary synthetic reproduction, or source proof.",
          "Run the focused compaction tests when feasible. Record exact commands and outcomes.",
          "Every commands item must be the full literal command that actually ran and must be copy-pastable. Never use ellipses, placeholders, or paraphrases.",
          "Check git status after the proof and leave the worktree clean.",
          "Classify the evidence accurately; do not call source inspection a live reproduction.",
          "",
          `Inspection result: ${JSON.stringify(outputs["inspect_issue"])}`,
        ].join("\n");
      },
      expectedOutput: [
        "{",
        '  "proofType": "source" | "unit" | "synthetic" | "local_live" | "blocked",',
        '  "reproduced": "yes" | "no" | "partial" | "blocked",',
        '  "commands": ["exact command"],',
        '  "observations": ["specific result"],',
        '  "rootCause": "verified cause or remaining uncertainty",',
        '  "confidence": "low" | "medium" | "high",',
        '  "workingTreeClean": true',
        "}",
      ].join("\n"),
      validate: validateProof,
    }),
    recommend_solution: agent({
      timeoutMs: 30 * 60_000,
      statusDetail: "judging solution",
      prompt: ({ input, outputs }) => {
        const issue = readInput(input);
        return [
          ...NO_WRITE_RULES,
          "",
          `Recommend the next maintainer action for ${issue.issueUrl}.`,
          "Decide whether the real fix is a narrow local patch or a good general solution.",
          "Judge the reporter's suggestions separately. Preserve cut-point validity, split-turn behavior, assistant/tool-result pairing, and reliable overflow recovery.",
          "Specify focused regression tests and remaining risks.",
          "This workflow is advisory only. Set mergeRecommended to false and leave the final decision to the human.",
          "",
          `Inspection: ${JSON.stringify(outputs["inspect_issue"])}`,
          `Proof: ${JSON.stringify(outputs["prove_issue"])}`,
        ].join("\n");
      },
      expectedOutput: [
        "{",
        '  "route": "actionable" | "duplicate_or_fixed" | "needs_more_evidence" | "not_local_model",',
        '  "solutionScope": "local" | "general",',
        '  "recommendedChange": "specific recommendation",',
        '  "invariants": ["behavior to preserve"],',
        '  "tests": ["focused test"],',
        '  "risks": ["remaining risk"],',
        '  "nextHumanDecision": "decision for the maintainer",',
        '  "mergeRecommended": false',
        "}",
      ].join("\n"),
      validate: validateRecommendation,
    }),
    finalize: compute({
      run: ({ input, outputs }) => {
        const issue = readInput(input);
        return {
          workflowTest: true,
          merged: false,
          githubChanged: false,
          issue: { number: issue.issueNumber, url: issue.issueUrl },
          inspection: outputs["inspect_issue"],
          proof: outputs["prove_issue"],
          recommendation: outputs["recommend_solution"],
          note: issue.operatorNote,
        };
      },
    }),
  },
  edges: [
    { from: "inspect_issue", to: "prove_issue" },
    { from: "prove_issue", to: "recommend_solution" },
    { from: "recommend_solution", to: "finalize" },
  ],
});

export function readInput(value: unknown): MaintainerWorkflowInput {
  if (!isRecord(value)) throw new Error("Workflow input must be an object");
  const issueNumber = readIssueNumber(value);
  assertReadOnlyFlags(value);
  const expectedUrl = `https://github.com/openclaw/openclaw/issues/${String(issueNumber)}`;
  if (
    value["repository"] !== "openclaw/openclaw" ||
    value["issueUrl"] !== expectedUrl ||
    value["operatorNote"] !== "This is a workflow test. Do not merge automatically."
  ) {
    throwReadOnlyInputError();
  }
  return {
    allowCommits: false,
    allowGitHubWrites: false,
    allowMerge: false,
    allowTrackedChanges: false,
    issueNumber,
    issueUrl: value["issueUrl"],
    operatorNote: value["operatorNote"],
    repository: "openclaw/openclaw",
    workflowTest: true,
  };
}

function readIssueNumber(value: Record<string, unknown>): number {
  const issueNumber = value["issueNumber"];
  if (typeof issueNumber !== "number" || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throwReadOnlyInputError();
  }
  return issueNumber;
}

function assertReadOnlyFlags(value: Record<string, unknown>): void {
  if (
    value["workflowTest"] !== true ||
    value["allowCommits"] !== false ||
    value["allowGitHubWrites"] !== false ||
    value["allowMerge"] !== false ||
    value["allowTrackedChanges"] !== false
  ) {
    throwReadOnlyInputError();
  }
}

function throwReadOnlyInputError(): never {
  throw new Error("Workflow input does not satisfy the read-only OpenClaw issue contract");
}

export function validateInspection(value: unknown): unknown {
  const record = requiredRecord(value, "inspection");
  requiredString(record, "issueTitle");
  requiredString(record, "plainProblem");
  requiredChoice(record, "stillApplies", ["yes", "no", "unclear"]);
  requiredStringArray(record, "implicatedFiles");
  requiredStringArray(record, "relatedRefs");
  requiredStringArray(record, "sourceEvidence");
  return record;
}

export function validateProof(value: unknown): unknown {
  const record = requiredRecord(value, "proof");
  requiredChoice(record, "proofType", ["source", "unit", "synthetic", "local_live", "blocked"]);
  requiredChoice(record, "reproduced", ["yes", "no", "partial", "blocked"]);
  const commands = requiredStringArray(record, "commands");
  for (const command of commands) {
    if (/(?:^|\s)(?:\.\.\.|…)(?:\s|$)/u.test(command)) {
      throw new Error("proof.commands must contain exact commands without elisions");
    }
  }
  requiredStringArray(record, "observations");
  requiredString(record, "rootCause");
  requiredChoice(record, "confidence", ["low", "medium", "high"]);
  if (record["workingTreeClean"] !== true) {
    throw new Error("proof.workingTreeClean must be true before the workflow can continue");
  }
  return record;
}

export function validateRecommendation(value: unknown): unknown {
  const record = requiredRecord(value, "recommendation");
  requiredChoice(record, "route", [
    "actionable",
    "duplicate_or_fixed",
    "needs_more_evidence",
    "not_local_model",
  ]);
  requiredChoice(record, "solutionScope", ["local", "general"]);
  requiredString(record, "recommendedChange");
  requiredStringArray(record, "invariants");
  requiredStringArray(record, "tests");
  requiredStringArray(record, "risks");
  requiredString(record, "nextHumanDecision");
  if (record["mergeRecommended"] !== false) {
    throw new Error("recommendation.mergeRecommended must be false in workflow-test mode");
  }
  return record;
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} output must be an object`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`);
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${key} must be an array of strings`);
    strings.push(item);
  }
  return strings;
}

function requiredChoice<const Choice extends string>(
  record: Record<string, unknown>,
  key: string,
  choices: readonly Choice[],
): Choice {
  const value = record[key];
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    throw new Error(`${key} must be one of: ${choices.join(", ")}`);
  }
  return choice;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
