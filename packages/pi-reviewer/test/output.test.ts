import { describe, expect, it } from "vitest";

import { PiEventCollector } from "../src/pi-events.js";
import { renderReview } from "../src/render.js";
import { parseReviewOutput } from "../src/review-output.js";

const VALID = {
  findings: [
    {
      title: "[P2] Handle empty input",
      body: "Empty input reaches the parser and throws before the caller can recover.",
      confidence_score: 0.9,
      priority: 2,
      code_location: {
        absolute_file_path: "/repo/src/parser.ts",
        line_range: { start: 10, end: 11 },
      },
    },
    {
      title: "Stop data loss",
      body: "This write replaces existing data when the process retries.",
      confidence_score: 0.95,
      priority: 0,
      code_location: {
        absolute_file_path: "/repo/src/store.ts",
        line_range: { start: 4, end: 4 },
      },
    },
    {
      title: "Avoid duplicate wake",
      body: "Two completion paths can wake the same request.",
      confidence_score: 0.8,
      priority: 1,
      code_location: {
        absolute_file_path: "/repo/src/run.ts",
        line_range: { start: 20, end: 21 },
      },
    },
  ],
  overall_correctness: "patch is incorrect",
  overall_explanation: "The patch has actionable defects.",
  overall_confidence_score: 0.92,
};

describe("review output", () => {
  it("validates and renders P0 through P3 findings in priority order", () => {
    const output = parseReviewOutput(JSON.stringify(VALID));
    const rendered = renderReview(output);
    expect(rendered).toContain("Overall: patch is incorrect (92% confidence)");
    expect(rendered.indexOf("[P0]")).toBeLessThan(rendered.indexOf("[P1]"));
    expect(rendered.indexOf("[P1]")).toBeLessThan(rendered.indexOf("[P2]"));
    expect(rendered).toContain("/repo/src/store.ts:4-4");

    const firstFinding = output.findings[0];
    if (firstFinding === undefined) throw new Error("expected a finding");
    const canonicalized = renderReview({
      ...output,
      findings: [{ ...firstFinding, title: "[P3] Wrong label", priority: 0 }],
    });
    expect(canonicalized).toContain("[P0] Wrong label");
    expect(canonicalized).not.toContain("[P3]");

    const unsafe = renderReview({
      ...output,
      overallExplanation: "unsafe\u001b]52;c;clipboard\u0007",
      findings: [
        {
          ...firstFinding,
          title: "[P2] Unsafe\u001b[2J title",
          body: "body\u0007text",
          codeLocation: { ...firstFinding.codeLocation, absoluteFilePath: "/repo/\u001bpath.ts" },
        },
      ],
    });
    expect(unsafe).not.toContain("\u001b");
    expect(unsafe).not.toContain("\u0007");
    expect(unsafe).toContain("�");
  });

  it("accepts one JSON object surrounded by incidental text", () => {
    const output = parseReviewOutput(`result follows\n${JSON.stringify(VALID)}\nend`);
    expect(output.findings).toHaveLength(3);
    const afterUnmatchedBrace = parseReviewOutput(
      `diagnostic { left open\n${JSON.stringify(VALID)}`,
    );
    expect(afterUnmatchedBrace.findings).toHaveLength(3);
  });

  it("renders a clean review without inventing findings", () => {
    const clean = parseReviewOutput(
      JSON.stringify({ ...VALID, findings: [], overall_correctness: "patch is correct" }),
    );
    expect(renderReview(clean)).toContain("No findings.");
  });

  it("scans bounded malformed output in linear time", () => {
    expect(() => parseReviewOutput("{".repeat(100_000))).toThrow("exactly one JSON object");
  }, 1_000);

  it("fails closed on malformed and ambiguous output", () => {
    expect(() => parseReviewOutput("not json")).toThrow("exactly one JSON object");
    expect(() => parseReviewOutput(`${JSON.stringify(VALID)} ${JSON.stringify(VALID)}`)).toThrow(
      "exactly one",
    );
    expect(() => parseReviewOutput(JSON.stringify({ ...VALID, extra: true }))).toThrow(
      "unknown field",
    );
    expect(() =>
      parseReviewOutput(
        JSON.stringify({ ...VALID, findings: [{ ...VALID.findings[0], priority: null }] }),
      ),
    ).toThrow("priority");
    expect(() =>
      parseReviewOutput(
        JSON.stringify({ ...VALID, findings: [{ ...VALID.findings[0], priority: 1 }] }),
      ),
    ).toThrow("title priority must match priority");
    expect(() =>
      parseReviewOutput(JSON.stringify({ ...VALID, overall_confidence_score: 2 })),
    ).toThrow("between 0 and 1");
    expect(() => parseReviewOutput(JSON.stringify({ ...VALID, findings: "bad" }))).toThrow("array");
    expect(() =>
      parseReviewOutput(JSON.stringify({ ...VALID, overall_correctness: "maybe" })),
    ).toThrow("overall_correctness");
    const finding = VALID.findings[0];
    expect(() =>
      parseReviewOutput(
        JSON.stringify({ ...VALID, findings: [{ ...finding, title: "x".repeat(81) }] }),
      ),
    ).toThrow("80 characters");
    expect(() =>
      parseReviewOutput(
        JSON.stringify({
          ...VALID,
          findings: [
            {
              ...finding,
              code_location: {
                absolute_file_path: "relative.ts",
                line_range: { start: 2, end: 2 },
              },
            },
          ],
        }),
      ),
    ).toThrow("must be absolute");
    expect(() =>
      parseReviewOutput(
        JSON.stringify({
          ...VALID,
          findings: [
            {
              ...finding,
              code_location: {
                absolute_file_path: "/repo/file.ts",
                line_range: { start: 2, end: 1 },
              },
            },
          ],
        }),
      ),
    ).toThrow("at least start");
    expect(() =>
      parseReviewOutput(JSON.stringify({ ...VALID, findings: [{ ...finding, body: "" }] })),
    ).toThrow("must be nonempty");
    expect(() =>
      parseReviewOutput(
        JSON.stringify({ ...VALID, findings: [{ ...finding, confidence_score: Number.NaN }] }),
      ),
    ).toThrow("between 0 and 1");
    expect(() =>
      parseReviewOutput(
        JSON.stringify({
          ...VALID,
          findings: [
            {
              ...finding,
              code_location: {
                absolute_file_path: "/repo/file.ts",
                line_range: { start: 0, end: 1 },
              },
            },
          ],
        }),
      ),
    ).toThrow("positive integer");
  });
});

describe("Pi JSON events", () => {
  it("collects a completed assistant response across arbitrary UTF-8 chunks", () => {
    const collector = new PiEventCollector();
    const expected = JSON.stringify({ ...VALID, overall_explanation: "The café change is valid." });
    const event = Buffer.from(
      `${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: expected }],
        },
      })}\n${JSON.stringify({ type: "agent_end", messages: [] })}\n`,
    );
    for (let index = 0; index < event.length; index += 1)
      collector.feed(event.subarray(index, index + 1));
    expect(collector.finish().finalText).toBe(expected);
  });

  it("rejects invalid, incomplete, errored, and oversized event streams", () => {
    const invalid = new PiEventCollector();
    expect(() => {
      invalid.feed("not-json\n");
    }).toThrow("invalid JSON");
    const invalidObject = new PiEventCollector();
    expect(() => {
      invalidObject.feed("[]\n");
    }).toThrow("invalid event object");
    const incomplete = new PiEventCollector();
    incomplete.feed(`${JSON.stringify({ type: "session" })}\n`);
    expect(() => incomplete.finish()).toThrow("before agent_end");
    const errored = new PiEventCollector();
    errored.feed(
      `${JSON.stringify({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "provider failed" },
      })}\n${JSON.stringify({ type: "agent_end", messages: [] })}\n`,
    );
    expect(() => errored.finish()).toThrow("provider failed");
    const recovered = new PiEventCollector();
    recovered.feed(
      `${JSON.stringify({
        type: "message_end",
        message: { role: "assistant", stopReason: "error" },
      })}\n${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "recovered" }],
        },
      })}\n${JSON.stringify({ type: "agent_end", messages: [] })}\n`,
    );
    expect(recovered.finish().finalText).toBe("recovered");
    const ignored = new PiEventCollector();
    ignored.feed(
      `${JSON.stringify({
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "ignore" }] },
      })}\n${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "thinking", text: "ignore" }],
        },
      })}\n${JSON.stringify({ type: "agent_end", messages: [] })}\n`,
    );
    expect(() => ignored.finish()).toThrow("no completed assistant response");
    const oversized = new PiEventCollector();
    expect(() => {
      oversized.feed("x".repeat(2 * 1024 * 1024 + 1));
    }).toThrow("oversized");
  });
});
