import assert from "node:assert/strict";
import { test } from "vitest";
import { lint, review } from "../index.ts";
import { rules } from "../rules.ts";

const EXAMPLE = `We rebuilt the editor from the ground up. No sign-ups, no downloads, no hassle — just paste your text and start writing. Everything runs locally in your browser.

The reviewer read the draft twice. Did not flinch, did not blink, did not reach for the red pen. That's the whole review, honestly.

Don't call it a rewrite — call it a rescue. The improvement is real, and it's not subtle. That loss is worth naming. Sit with that for a moment. The gains were modest, but that's not nothing.

You already know the answer, of course. Consistency is the entire game, and the punchline is that nobody wants to hear it. The entire pitch is one sentence long.

In this guide we delve into the redesign. It is important to note that the rollout happened in stages. Community feedback plays a pivotal role in every release. Experts argue that the shift was overdue.

The studio is nestled in a converted warehouse. The finished space is not just an office, but a small museum. Visitors keep coming back, reflecting the appeal of the collection. The steady attendance is a testament to the curators.

Despite these challenges, the team kept shipping. They adapted to an ever-evolving landscape. As of my last update, the pricing page still said "coming soon".

The parser is a tiny state machine. The renderer is a tiny state machine.

I won't pretend the rollout was smooth. It turns out that nobody reads the changelog. Here is the whole secret. The small core still fits in your head. That's the part a schedule can't capture. It's the only estimate I trust. You don't have to take my word for it.

The launch needed three things: a blog post, a demo video, and a pricing page. Here's the catch: the demo was recorded months earlier. Do I regret shipping it? Do I miss the old importer?

The old importer is dead, and nobody mourned. That's why the export button mattered. The tool died; the data didn't.

Maybe nobody needed the importer. Maybe the shortcut confused people. Maybe the redesign was overdue all along.

The change is provably correct, and the verdict stands. The seam between the modules has grown; the refactor survived review. Once the fix is proven, the performance ceiling is gone. The floor has moved up, the argument settled, and the result is genuinely small.

This closing paragraph is intentionally ordinary, with no list patterns at all, so nothing here should light up.`;

test("every rule has a description", () => {
  for (const rule of rules) {
    assert.ok(rule.description.trim().length > 0, `${rule.id}: description is empty`);
  }
});

test("rule ids are unique", () => {
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("example text exercises the minHits rules at their thresholds", () => {
  const findings = lint(EXAMPLE);
  const count = (id: string) => findings.filter((f) => f.ruleId === id).length;
  // two occurrences each; the second ai-vocab word ("pivotal") sits inside
  // the crucial-role span and is swallowed by the overlap deduplication
  assert.equal(count("ai-vocab"), 1);
  assert.equal(count("vocab-stance-2"), 2);
  assert.equal(count("vocab-metaphor-2"), 2);
  assert.equal(count("vocab-survival-2"), 2);
});

test("findings are sorted and their text slices match the input", () => {
  const findings = lint(EXAMPLE);
  for (let i = 1; i < findings.length; i += 1) {
    assert.ok(findings[i - 1]!.start <= findings[i]!.start, "sorted by start");
  }
  for (const f of findings) {
    assert.equal(f.text, EXAMPLE.slice(f.start, f.end), `text slice for ${f.ruleId}`);
  }
});

test("plain text yields no findings", () => {
  assert.equal(lint("The parser is small and the tests are slow.").length, 0);
});

test("options.rules restricts the run to the named rules", () => {
  const findings = lint(EXAMPLE, { rules: ["no-chain", "whole"] });
  assert.ok(findings.length > 0);
  assert.deepEqual(new Set(findings.map((f) => f.ruleId)), new Set(["no-chain", "whole"]));
});

test("minHits rules ignore a single occurrence", () => {
  assert.equal(lint("The fix is proven.").length, 0);
  assert.equal(lint("I will delve into it.").length, 0);
  const two = lint("The fix is proven, and the debate settled.");
  assert.deepEqual(
    two.map((f) => f.ruleId),
    ["vocab-survival-2", "vocab-survival-2"],
  );
});

test("review at strictness 0 never blocks", () => {
  const r = review("The fix is provably correct.", { strictness: 0 });
  assert.equal(r.verdict, "pass");
  assert.equal(r.findings.length, 0);
});

test("review at strictness 1 blocks on any finding", () => {
  const r = review("The fix is provably correct.", { strictness: 1 });
  assert.equal(r.verdict, "rewrite");
  assert.deepEqual(
    r.findings.map((f) => f.ruleId),
    ["vocab-stance"],
  );
});

test("review passes clean text even at strictness 1", () => {
  const r = review("The parser is small and the tests are slow.", {
    strictness: 1,
  });
  assert.equal(r.verdict, "pass");
  assert.equal(r.findings.length, 0);
});

test("review blocks on density, not raw findings", () => {
  // Clean filler: openers are varied so the many repetitions do not trip the
  // repeated-openers rule (three consecutive “The …” sentences would).
  const filler = [
    "Parsers handle input and report errors cleanly.",
    "Our build runs fast and the output stays clean.",
  ];
  const text =
    Array.from({ length: 45 }, (_, i) => filler[i % 2]).join(" ") + " The fix is provably correct.";
  const words = text.split(/\s+/).length;
  const lenient = review(text, { strictness: 0.5 });
  assert.equal(lenient.verdict, "pass");
  assert.equal(lenient.score, 1000 / words);
  assert.ok(lenient.score < lenient.threshold, "below the density threshold");
  const strict = review(text, { strictness: 0.9 });
  assert.equal(strict.verdict, "rewrite");
  assert.ok(strict.score >= strict.threshold, "above the density threshold");
});

test("per-rule 0 ignores a rule, per-rule 1 always blocks", () => {
  const text = "The change is provably correct, and the verdict stands.";
  // provably (vocab-stance) and verdict (vocab-epistemic)
  const ignored = review(text, {
    strictness: 1,
    rules: { "vocab-stance": 0 },
  });
  assert.equal(ignored.verdict, "rewrite");
  assert.deepEqual(
    ignored.findings.map((f) => f.ruleId),
    ["vocab-epistemic"],
  );
  const vendetta = review(text, {
    strictness: 0,
    rules: { "vocab-stance": 1 },
  });
  assert.equal(vendetta.verdict, "rewrite");
  assert.deepEqual(
    vendetta.findings.map((f) => f.ruleId),
    ["vocab-stance"],
  );
});
