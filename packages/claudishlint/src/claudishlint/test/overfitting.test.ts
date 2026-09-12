import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { lint } from "../index.ts";
import type { Finding } from "../types.ts";

const assertHasRuleCount = (findings: Finding[], ruleId: string, count: number) => {
  assert.equal(findings.filter((f) => f.ruleId === ruleId).length, count, ruleId);
};

describe("overfitting fixture 1", () => {
  const text = `Fixer 4 (ingest/authoring) is home — and it shipped the wire-up, not the cop-out: column roles are now real. ignore drops a column from unit metadata at unitize — before the Pll step, so ignored values are never scanned, never reach Director prompts, never ride exports (pinned by test: an email in an ignored column counts zero). Roles persist as corpus provenance, and it dodged a collision the audit's suggested fix would have caused (the proposed key was already the columns-route cache). Also landed: honest Instant Read lede (no phantom click affordance), the "all local" badge scoped truthfully, Pll copy that names metadata columns and the vault's travel behavior, skipped-empty-rows counts in the import toast, live parser warnings showing their detail again, "The analysis it recommends" with the billed-compile disclosure on Approve, + New construct (hand-authoring now has a UI path), inductive themes stamped with their source corpus, and the numeric-label type preservation in the example picker.`;

  test("structural tells are flagged", () => {
    const findings = lint(text);

    // "never scanned, never reach Director prompts, never ride exports"
    assertHasRuleCount(findings, "never-chain", 1);
    // "shipped the wire-up, not the cop-out"
    assertHasRuleCount(findings, "x-not-y", 1);
  });

  test("vocabulary tells are flagged", () => {
    const findings = lint(text);

    // phantom, affordance, construct
    assertHasRuleCount(findings, "vocab-metaphor", 3);
    // honest + truthfully
    assertHasRuleCount(findings, "vocab-stance-2", 2);
  });
});

describe("overfitting fixture 2 — repeated openers", () => {
  test("list bullets must not form an anaphora run on `-`", () => {
    const text = `## Summary
- Change the microCMS Select field filter operator from \`[equals]\` to \`[contains]\` in \`events.ts\` and \`informations.ts\`.
- Remove the invalid display name (\`: 協賛企業\`) from the informations filter value.
- Set all AboutSection text colour to a white tone for the dark background.
- Add a white gradient mask to HeroSection.
- Remove the SMTP configuration placeholders from \`.env.example\`.`;

    // Bullet heads are their actual first words (Change, Remove, Set, Add,
    // Remove), which differ, so no run is reported.
    assertHasRuleCount(lint(text), "sentence-anaphora", 0);
  });

  test("a genuine `The … The … The …` run must fire, not the neighbouring bullets", () => {
    const text = `- \`getBodyLayout()\` returns both world-unit dimensions and backward-compatible pixel values for armor detail offsets.
- The detail unit \`U = 0.125 * scale\` is used for armor padding, rivets, and small features.
- All character parts are positioned in character-root space (feet at Y=0) unless attached to an arm.
- Arm groups enable rotation from the shoulder pivot point.
- Proportions are tuned for visual balance. The torso is V-shaped. The limbs are thin. The legs are.`;

    const anaphora = lint(text).filter((f) => f.ruleId === "sentence-anaphora");

    // The bullets (`getBodyLayout`, The, All, Arm, Proportions, …) differ and
    // are not flagged; only the real `The … The … The …` run is.
    assertHasRuleCount(lint(text), "sentence-anaphora", 1);
    assert.deepEqual(
      anaphora.map((f) => ({
        start: f.start,
        end: f.end,
        count: f.count,
        text: f.text,
      })),
      [
        {
          start: 417,
          end: 473,
          count: 3,
          text: "The torso is V-shaped. The limbs are thin. The legs are.",
        },
      ],
    );
  });
});
