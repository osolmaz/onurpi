/** A single span a rule flagged inside the input text. */
export interface Match {
  /** Character offset of the start of the match (inclusive). */
  start: number;
  /** Character offset of the end of the match (exclusive). */
  end: number;
  /** For chain/run rules: how many repeated items the run contains. */
  count?: number;
}

/** One lint rule: a name, a description of the pattern and what to do, and a finder. */
export interface Rule {
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** What the pattern is and what to write instead — feedback for whoever fixes the text. */
  description: string;
  /**
   * Minimum number of occurrences in one message before the rule produces
   * findings at all. Rules whose description says a single hit can be a
   * coincidence set this to 2; the default is 1.
   */
  minHits?: number;
  /** Returns every flagged span for the rule, in any order. */
  find(text: string): Match[];
}

/** A resolved finding produced by `lint`. */
export interface Finding {
  /** The id of the rule that produced this finding. */
  ruleId: string;
  start: number;
  end: number;
  /** The matched text, copied from the input. */
  text: string;
  count?: number;
}

export interface LintOptions {
  /** Restrict to these rule ids; omit to run every rule. */
  rules?: string[];
}

/**
 * Per-rule strictness overrides for `review`. `0` =
 * ignore the rule entirely; `1` = any finding of the rule blocks regardless
 * of message length. Rules not listed use the global strictness.
 */
export type StrictnessOverrides = Record<string, 0 | 1>;

export interface ReviewOptions {
  /**
   * How trigger-happy the gate is, 0–1. `0` = never re-prompt, `1` =
   * re-prompt on any finding (the default). Lower it to tolerate long,
   * mostly-fine messages: the pass/fail line becomes a density threshold of
   * count-aware findings per 1000 words.
   */
  strictness?: number;
  /** Per-rule overrides: `0` = ignore, `1` = always block. */
  rules?: StrictnessOverrides;
}

export interface ReviewResult {
  /** `"rewrite"` when the message is Claudish enough to warrant a rewrite. */
  verdict: "rewrite" | "pass";
  /** Count-aware findings per 1000 words (ignored rules excluded). */
  score: number;
  /** The density threshold the score was compared against. */
  threshold: number;
  /** The findings from non-ignored rules, for building the re-prompt (keyed by rule ID) */
  findings: {
    ruleId: string;
    name: string;
    description: string;
    passages: string[];
  }[];
}
