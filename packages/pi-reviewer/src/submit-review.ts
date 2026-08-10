import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { parseReviewOutput } from "./review-output.js";

const lineRange = Type.Object(
  {
    start: Type.Integer({ minimum: 1 }),
    end: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const finding = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 80 }),
    body: Type.String({ minLength: 1 }),
    confidence_score: Type.Number({ minimum: 0, maximum: 1 }),
    priority: Type.Integer({ minimum: 0, maximum: 3 }),
    code_location: Type.Object(
      {
        absolute_file_path: Type.String({ minLength: 1 }),
        line_range: lineRange,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const reviewSubmissionSchema = Type.Object(
  {
    findings: Type.Array(finding),
    overall_correctness: StringEnum(["patch is correct", "patch is incorrect"] as const),
    overall_explanation: Type.String({ minLength: 1 }),
    overall_confidence_score: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export type ReviewSubmission = {
  readonly findings: {
    readonly title: string;
    readonly body: string;
    readonly confidence_score: number;
    readonly priority: number;
    readonly code_location: {
      readonly absolute_file_path: string;
      readonly line_range: { readonly start: number; readonly end: number };
    };
  }[];
  readonly overall_correctness: "patch is correct" | "patch is incorrect";
  readonly overall_explanation: string;
  readonly overall_confidence_score: number;
};

export function createSubmitReviewTool(
  cwd: string,
  onSubmit: (submission: ReviewSubmission) => void,
): ToolDefinition {
  let submitted = false;
  return defineTool({
    name: "submit_review",
    label: "Submit review",
    description:
      "Submit the final code review in the required machine-readable schema and end the review. Use this exactly once as the final action.",
    promptSnippet: "Submit the final validated review and end the review",
    promptGuidelines: [
      "Use submit_review exactly once as the final action after gathering enough evidence.",
      "Call submit_review instead of returning the final review as prose or a JSON text block.",
    ],
    parameters: reviewSubmissionSchema,
    execute(_toolCallId, params) {
      if (submitted) throw new Error("submit_review may be called only once");
      parseReviewOutput(JSON.stringify(params), cwd);
      submitted = true;
      onSubmit(params);
      return Promise.resolve({
        content: [{ type: "text" as const, text: "Final review submitted." }],
        details: params,
        terminate: true,
      });
    },
  });
}
