import { terminalText } from "./terminal-text.js";
import type { ReviewFinding, ReviewOutput } from "./types.js";

export function renderReview(output: ReviewOutput): string {
  const sections: string[] = [
    `Overall: ${output.overallCorrectness} (${percent(output.overallConfidenceScore)} confidence)`,
    terminalText(output.overallExplanation.trim()),
  ];
  if (output.findings.length === 0) {
    sections.push("No findings.");
  } else {
    sections.push(renderFindings(output.findings));
  }
  return `${sections.join("\n\n")}\n`;
}

export function renderReviewJson(output: ReviewOutput): string {
  return `${JSON.stringify({
    findings: output.findings.map((finding) => ({
      title: finding.title,
      body: finding.body,
      confidence_score: finding.confidenceScore,
      priority: finding.priority,
      code_location: {
        absolute_file_path: finding.codeLocation.absoluteFilePath,
        line_range: {
          start: finding.codeLocation.lineRange.start,
          end: finding.codeLocation.lineRange.end,
        },
      },
    })),
    overall_correctness: output.overallCorrectness,
    overall_explanation: output.overallExplanation,
    overall_confidence_score: output.overallConfidenceScore,
  })}\n`;
}

function renderFindings(findings: readonly ReviewFinding[]): string {
  const ordered = [...findings].sort((left, right) => left.priority - right.priority);
  const lines = [findings.length === 1 ? "Review finding:" : "Review findings:"];
  for (const finding of ordered) {
    const location = `${terminalText(finding.codeLocation.absoluteFilePath)}:${String(finding.codeLocation.lineRange.start)}-${String(finding.codeLocation.lineRange.end)}`;
    lines.push(
      "",
      `- ${priorityTitle(finding)} — ${location}`,
      `  ${terminalText(finding.body)}`,
      `  Confidence: ${percent(finding.confidenceScore)}`,
    );
  }
  return lines.join("\n");
}

function priorityTitle(finding: ReviewFinding): string {
  const title = terminalText(finding.title).replace(/^\[P[0-3]\]\s*/u, "");
  return `[P${String(finding.priority)}] ${title}`;
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}
