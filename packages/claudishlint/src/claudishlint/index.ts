import { rules } from "./rules.ts";
import type { Finding, LintOptions, ReviewOptions, ReviewResult } from "./types.ts";

const DEFAULT_STRICTNESS = 1.0;

export function lint(text: string, options: LintOptions = {}): Finding[] {
  const enabled = options.rules ? new Set(options.rules) : null;
  const matches = rules
    .filter((rule) => !enabled || enabled.has(rule.id))
    .flatMap((rule) => {
      const found = rule.find(text);
      return (found.length >= (rule.minHits ?? 1) ? found : []).map((m) => ({
        ruleId: rule.id,
        ...m,
      }));
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  return matches.reduce<Finding[]>((findings, m) => {
    const last = findings[findings.length - 1];
    if (last && m.start < last.end) {
      return findings;
    }
    findings.push({ ...m, text: text.slice(m.start, m.end) });
    return findings;
  }, []);
}

export function review(text: string, options: ReviewOptions = {}): ReviewResult {
  const strictness = options.strictness ?? DEFAULT_STRICTNESS;
  const relevant = lint(text).filter((f) => (options.rules?.[f.ruleId] ?? strictness) > 0);
  const words = Math.max(text.split(/\s+/).length, 1);
  const score = relevant.reduce((n, f) => n + (f.count ?? 1), 0);
  const density = (score / words) * 1000;
  const baseDensity = 10;
  const threshold = (baseDensity * (1 - strictness)) / strictness;
  const blocked = relevant.some((f) => (options.rules?.[f.ruleId] ?? strictness) >= 1);

  const findings = groupByRule(relevant);

  return {
    verdict: relevant.length > 0 && (blocked || density >= threshold) ? "rewrite" : "pass",
    score: density,
    threshold,
    findings,
  };
}

const groupByRule = (findings: Finding[]) => [
  ...findings
    .reduce((groups, f) => {
      // biome-ignore lint/style/noNonNullAssertion: it's fine
      const rule = rules.find((r) => r.id === f.ruleId)!;
      const group = groups.get(f.ruleId) ?? {
        ruleId: f.ruleId,
        name: rule.name,
        description: rule.description,
        passages: [],
      };
      group.passages.push(f.text);
      return groups.set(f.ruleId, group);
    }, new Map<string, { ruleId: string; name: string; description: string; passages: string[] }>())
    .values(),
];
