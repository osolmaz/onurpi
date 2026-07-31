import type { ReviewFinding, ReviewOutput } from "./types.js";

export function renderReview(output: ReviewOutput): string {
  const sections: string[] = [
    `Overall: ${output.overallCorrectness} (${percent(output.overallConfidenceScore)} confidence)`,
    output.overallExplanation.trim(),
  ];
  if (output.findings.length === 0) {
    sections.push("No findings.");
  } else {
    sections.push(renderFindings(output.findings));
  }
  return `${sections.join("\n\n")}\n`;
}

function renderFindings(findings: readonly ReviewFinding[]): string {
  const ordered = [...findings].sort((left, right) => left.priority - right.priority);
  const lines = [findings.length === 1 ? "Review finding:" : "Review findings:"];
  for (const finding of ordered) {
    const location = `${finding.codeLocation.absoluteFilePath}:${String(finding.codeLocation.lineRange.start)}-${String(finding.codeLocation.lineRange.end)}`;
    lines.push(
      "",
      `- ${priorityTitle(finding)} — ${location}`,
      `  ${finding.body}`,
      `  Confidence: ${percent(finding.confidenceScore)}`,
    );
  }
  return lines.join("\n");
}

function priorityTitle(finding: ReviewFinding): string {
  const title = finding.title.replace(/^\[P[0-3]\]\s*/u, "");
  return `[P${String(finding.priority)}] ${title}`;
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}
