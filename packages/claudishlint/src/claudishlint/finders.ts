import type { Match } from "./types.ts";

/** A finder turns raw text into a list of {@link Match} spans. */
export type Finder = (text: string) => Match[];

const CHAIN_BODY = String.raw`[^,.;:!?\n\u2013\u2014\u2026]*`;
const CHAIN_SEP = String.raw`(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+|\s*[;&\u2013\u2014]\s*(?:and\s+|or\s+)?|\s+-{1,2}\s+)`;
const CHAIN_SPLIT = new RegExp(CHAIN_SEP, "i");

export function makeChainFinder(head: string, headTest: RegExp): Finder {
  const item = head + CHAIN_BODY;
  const chain = new RegExp(String.raw`\b${item}(?:${CHAIN_SEP}${item})+`, "gi");
  return (text) =>
    [...text.matchAll(chain)].map((m) => {
      const trimmed = m[0].replace(/\s+$/, "");
      const count = m[0].split(CHAIN_SPLIT).filter((p) => headTest.test(p.trim())).length;
      return { start: m.index, end: m.index + trimmed.length, count };
    });
}

export function makeRegexFinder(re: RegExp): Finder {
  return (text) =>
    [...text.matchAll(re)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
    }));
}

interface EchoOptions {
  /** Minimum n-gram size shared between two sentences. */
  minGram?: number;
  /** Minimum number of consecutive echoing sentences to flag. */
  minRun?: number;
}

export function makeEchoFinder({ minGram = 3, minRun = 2 }: EchoOptions = {}): Finder {
  const SENT = /[^.!?\n]+[.!?]?/g;
  const grams = (s: string, n: number): Set<string> => {
    const w = s.toLowerCase().match(/[a-z0-9'’-]+/g) || [];
    const out = new Set<string>();
    for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(" "));
    return out;
  };
  // eslint-disable-next-line complexity -- the upstream loop keeps its sentence-run state machine in one function
  return (text) => {
    const sents = [...text.matchAll(SENT)]
      .filter((m) => (m[0].match(/\S+/g) || []).length >= 4)
      .map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
    const found: Match[] = [];
    let i = 0;
    while (i < sents.length) {
      let j = i;
      let shared: string | null = null;
      while (j + 1 < sents.length) {
        // Both indexes stay inside the array because of the loop guard.
        const current = sents[j]!;
        const next = sents[j + 1]!;
        if (next.start - current.end > 3) break;
        const a = grams(current.text, minGram);
        const b = grams(next.text, minGram);
        const common = [...a].filter((g) => b.has(g));
        if (!common.length) break;
        shared = common.sort((x, y) => y.length - x.length)[0]!;
        j += 1;
      }
      const run = j - i + 1;
      if (run >= minRun && shared) {
        let end = sents[j]!.end;
        while (end > sents[i]!.start && /\s/.test(text[end - 1]!)) end -= 1;
        found.push({ start: sents[i]!.start, end, count: run });
        i = j + 1;
      } else {
        i += 1;
      }
    }
    return found;
  };
}

interface QuestionChainOptions {
  /** Minimum number of consecutive questions to flag. */
  minRun?: number;
}

export function makeQuestionChainFinder({ minRun = 2 }: QuestionChainOptions = {}): Finder {
  const chain = /[^.!?\n]+\?(?:\s+[^.!?\n]+\?)+/g;
  return (text) =>
    [...text.matchAll(chain)]
      .map((m) => ({
        start: m.index + m[0].length - m[0].trimStart().length,
        end: m.index + m[0].length,
        count: (m[0].match(/\?/g) || []).length,
      }))
      .filter((f) => f.count >= minRun);
}

// Deliberately openers whose repetition is not (by itself) a Claudish tell.
// `the` is intentionally absent: a run of three “The …” openers is the very
// repetitive tic the rule exists to catch.
const ANAPHORA_SKIP =
  /^(?:i|it|a|an|this|that|we|you|they|he|she|there|but|and|so|in|as|if|my|his|her|their|its|these|those|for|at|on|of|to|is|was)$/i;

interface AnaphoraOptions {
  /** Minimum number of consecutive same-opening sentences to flag. */
  minRun?: number;
}

export function makeAnaphoraFinder({ minRun = 3 }: AnaphoraOptions = {}): Finder {
  const SENT = /[^.!?\n]+[.!?]/g;
  return (text) => {
    const sents = [...text.matchAll(SENT)].flatMap((m) => {
      // First real word. `-` (list bullets) and other leading punctuation are
      // deliberately excluded, so a run of markdown bullets does not look
      // like a repeated opener.
      // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- one extraction, no match flags needed
      const w = m[0].match(/[A-Za-z'’]+/);
      return w
        ? [
            {
              start: m.index + m[0].indexOf(w[0]),
              end: m.index + m[0].length,
              head: w[0].toLowerCase(),
            },
          ]
        : [];
    });
    const found: Match[] = [];
    let i = 0;
    while (i < sents.length) {
      let j = i;
      while (j + 1 < sents.length) {
        const current = sents[j]!;
        const next = sents[j + 1]!;
        if (next.head !== sents[i]!.head || next.start - current.end >= 4) break;
        j += 1;
      }
      const run = j - i + 1;
      if (run >= minRun && !ANAPHORA_SKIP.test(sents[i]!.head)) {
        found.push({ start: sents[i]!.start, end: sents[j]!.end, count: run });
        i = j + 1;
      } else i += 1;
    }
    return found;
  };
}
