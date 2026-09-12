import {
  makeAnaphoraFinder,
  makeChainFinder,
  makeEchoFinder,
  makeQuestionChainFinder,
  makeRegexFinder,
} from "./finders.ts";
import type { Rule } from "./types.ts";

export const rules: Rule[] = [
  {
    id: "no-chain",
    name: "“No X, no Y” chains",
    description:
      "This is a run of two or more “no …” items in a row. State the items once in a plain sentence or list.",
    find: makeChainFinder(String.raw`no[-\s]`, /^no[-\s]/i),
  },
  {
    id: "whole",
    name: "“That’s the whole …”",
    description: "This phrasing is fluff. Delete it and state the point directly.",
    find: makeRegexFinder(
      /\b(?:that|this)(?:['\u2019]s|\s+(?:is|was))\s+the\s+whole\b(?:\s+\w+)?/gi,
    ),
  },
  {
    id: "did-not-chain",
    name: "“Did not X, did not Y” chains",
    description: "These are two or more “did not …” items in a row. Merge them into one statement.",
    find: makeChainFinder(
      String.raw`(?:did\s+not|didn['\u2019]t)\s`,
      /^(?:did\s+not|didn['\u2019]t)\s/i,
    ),
  },
  {
    id: "never-chain",
    name: "“Never X, never Y” chains",
    description:
      "This is a run of two or more “never …” items. State the list once in a plain sentence.",
    find: makeChainFinder(String.raw`never\s`, /^never\s/i),
  },
  {
    id: "dont-verb-it",
    name: "“Don’t VERB it … VERB it”",
    description:
      "This is a negated verb + “it” immediately followed by the same verb + “it”. Give the positive instruction once.",
    find: makeRegexFinder(
      /\b(?:do\s+not|don['\u2019]t)\s+(?:just\s+|simply\s+|merely\s+)?(\w+)(?:\s+(?:of|about|at|on|for|with|to))?\s+it\b[^.!?\n]*?[.!?;,:\u2013\u2014]['"\u201d\u2019]*\s*(?:just\s+|simply\s+|merely\s+)?\1(?:\s+(?:of|about|at|on|for|with|to))?\s+it\b/gi,
    ),
  },
  {
    id: "sit-with",
    name: "“Sit with that”",
    description:
      "This is the reflective “sit with that” / “sit with the discomfort” frame. Say what the reader should actually do or feel, or cut the sentence.",
    find: makeRegexFinder(
      /\bsit(?:s|ting)?\s+with\s+(?:that|this|it|(?:the|your)\s+(?:discomfort|feelings?|tension|weight|uncertainty|ambiguity|grief|silence|unease))\b(?:\s+for\s+a\s+\w+)?/gi,
    ),
  },
  {
    id: "already-know",
    name: "“You already know”",
    description:
      "This is a “you already know” gesture at a fact. State the fact instead of gesturing at it.",
    find: makeRegexFinder(
      /\byou\s+already\s+knows?\s+(?:the\s+answer|what|how|why|this|that|it|who|where)\b|\byou\s+already\s+knows?\b(?![ \t]+\w)/gi,
    ),
  },
  {
    id: "is-the-entire",
    name: "“Is the entire …”",
    description:
      "This is an “X is the entire point / game / business model” superlative frame. Say what the thing is without the superlative.",
    find: makeRegexFinder(/(?:\b(?:is|was|are|were)|['\u2019]s)\s+the\s+entire\b(?:\s+\w+)?/gi),
  },
  {
    id: "the-entire-is",
    name: "“The entire … is”",
    description:
      "This is a “The entire point / game / business model is …” superlative frame. Name the thing and its property directly.",
    find: makeRegexFinder(
      /\bthe\s+entire\s+[\w'\u2019-]+(?:\s+[\w'\u2019-]+){0,4}?\s+(?:is|was|are|were)\b/gi,
    ),
  },
  {
    id: "is-real",
    name: "“Is real … and / not”",
    description:
      "This is an “X is real, and / not …” decoration. Drop the “is real” flourish and state the claim it was decorating.",
    find: makeRegexFinder(
      /\bis\s+(?:(?:the|a)\s+real\b(?![\s-]+(?:estate|time|life|world|quick)\b)[^.!?\n]*?\b(?:and|not)\s+it\b|real\b(?![\s-]+(?:estate|time|life|world|quick)\b)[^.!?\n]*?\b(?:and|not)\b)/gi,
    ),
  },
  {
    id: "punchline",
    name: "“The punchline is”",
    description:
      "This is a “the punchline is …” reveal. State the conclusion without the reveal framing.",
    find: makeRegexFinder(/\bthe\s+punchline(?:\s+(?:is|was|being)\b|\s*[:?])/gi),
  },
  {
    id: "worth-naming",
    name: "“Worth naming”",
    description:
      "This is the “it’s worth naming” meta-commentary. Name the thing directly and drop the meta-commentary.",
    find: makeRegexFinder(
      /(?:\b(?:is|are|was|were|feels?|felt|seems?|seemed)|['\u2019]s)\s+(?:\w+\s+){0,2}?worth\s+naming\b(?!\s+names\b)|\bworth\s+naming\s*:/gi,
    ),
  },
  {
    id: "not-nothing",
    name: "“That’s not nothing”",
    description:
      "This is a “that’s not nothing” double negative used for weight. Say what it actually is, with a number or a concrete claim.",
    find: makeRegexFinder(
      /\b(?:that|this|it|which)(?:['\u2019]s|\s+(?:is|was))\s+not\s+nothing\b/gi,
    ),
  },
  {
    id: "is-the-whole",
    name: "“Is the whole …”",
    description:
      "This is an “X is the whole point / trick / idea” frame or a “here is the whole …” opener. Say the point directly and drop the frame.",
    find: makeRegexFinder(
      /(?:\b(?:is|was|are|were)|['\u2019]s)\s+the\s+whole\b(?:\s+\w+)?|\bhere(?:['\u2019]s|\s+is)\s+the\s+whole\b(?:\s+\w+)?/gi,
    ),
  },
  {
    id: "echo-triad",
    name: "Echoing sentence runs",
    description:
      "These are consecutive sentences built on the same repeated skeleton. Combine them into one, or vary their structure.",
    find: makeEchoFinder({ minGram: 4, minRun: 2 }),
  },
  {
    id: "performative-honesty",
    name: "Performative honesty",
    description:
      "This is sincerity announced rather than demonstrated. State the honest thing without announcing your honesty.",
    find: makeRegexFinder(
      /\bI\s+(?:will\s+not|won['\u2019]t)\s+pretend\b|\b(?:I['\u2019]ll|let['\u2019]s|to)\s+be\s+(?:honest|clear|blunt|real)\b|(?:^|[.!?–—]\s+|\n)(?:Honestly|Look|Truthfully|Frankly)\s*,/gi,
    ),
  },
  {
    id: "thats-the-part",
    name: "“That’s the part …”",
    description:
      "This is gesturing at a favoured detail instead of stating it. State the detail directly.",
    find: makeRegexFinder(
      /\b(?:that|this|it)(?:['\u2019]s|\s+(?:is|was))\s+the\s+part\b|\bthe\s+part\s+that\s+(?:makes|made|gets|got|keeps|kept)\s+(?:me|you|us|it)\b|\bmy\s+favou?rite\s+part\s+of\b/gi,
    ),
  },
  {
    id: "the-only-i-trust",
    name: "“The only X I trust”",
    description:
      "This is a “the only X I trust / that matters” superlative reveal. State the claim without the superlative.",
    find: makeRegexFinder(
      /\bthe\s+only\s+[\w'\u2019-]+(?:\s+[\w'\u2019-]+){0,2}?\s+(?:I|you|we|it|he|she|they)\s+(?:trust|need|needs|care|want|wants|use|uses|believe)\b|\bthe\s+only\s+[\w'\u2019-]+\s+that\s+(?:matters|counts|works|survives)\b/gi,
    ),
  },
  {
    id: "take-my-word",
    name: "“Don’t take my word for it”",
    description:
      "This is the stock invitation to verify. Point to the source directly, or drop the invitation.",
    find: makeRegexFinder(
      /\b(?:you\s+)?(?:do\s+not|don['\u2019]t)\s+(?:have\s+to\s+)?take\s+my\s+word\s+for\s+(?:it|any\s+of\s+(?:it|this|that))\b/gi,
    ),
  },
  {
    id: "turns-out",
    name: "“Turns out …”",
    description:
      "This is a “turns out” casual-revelation opener bolted to a tidy conclusion. State the result without the reveal.",
    find: makeRegexFinder(/(?:^|[.!?–—]\s+|\n)Turns\s+out\b|\bit\s+turns\s+out\s+that\b/gi),
  },
  {
    id: "fits-in-your-head",
    name: "“Fits in your head”",
    description:
      "This is dev-blog boilerplate for simplicity. Say what the design concretely does instead.",
    find: makeRegexFinder(
      /\b(?:hold|fit|fits|holds|held)\s+(?:it\s+)?in\s+your\s+head\b|\bbatteries[-\s]included\b|\bit\s+just\s+works\b|\bzero[-\s]config(?:uration)?\b|\bsane\s+defaults\b/gi,
    ),
  },
  {
    id: "stacked-questions",
    name: "Stacked rhetorical questions",
    description:
      "These are two or more questions fired in a row, usually fragments after the first. Replace the run with a statement, or keep a single real question.",
    find: makeQuestionChainFinder({ minRun: 2 }),
  },
  {
    id: "sentence-anaphora",
    name: "Repeated sentence openers",
    description:
      "These are three or more consecutive sentences starting on the same word. Vary the sentence openings.",
    find: makeAnaphoraFinder({ minRun: 3 }),
  },
  {
    id: "emoji-heading",
    name: "Emoji headers and list bullets",
    description:
      "This is an emoji heading a markdown header or list item. Drop the emoji and keep the plain label.",
    find: makeRegexFinder(
      // eslint-disable-next-line no-misleading-character-class -- the class lists combining marks on purpose
      /^[ \t]*(?:#{1,6}[ \t]+|(?:[-*+][ \t]+|\d+[.)][ \t]+))?[\p{Extended_Pictographic}\u{200D}\u{FE0F}]+[ \t]+(?=\S)/gmu,
    ),
  },
  {
    id: "colon-triple",
    name: "Colon into a triple",
    description:
      "This is a colon opening onto three or more comma-separated items. Use a plain list or sentence.",
    find: makeRegexFinder(
      /:\s+[^.!?;:\n]{2,40},\s+[^.!?;:\n]{2,40},\s+(?:and\s+|or\s+)?[^.!?;:\n]{2,40}(?=[.!?\n])/g,
    ),
  },
  {
    id: "heres-the-twist",
    name: "“Here’s the twist”",
    description:
      "This is a stage-managed reveal opener. State the point directly without the reveal.",
    find: makeRegexFinder(
      /\bhere(?:['\u2019]s|\s+is)\s+(?:the|a|my|one)\s+(?:twist|thing|catch|kicker|rub|problem|first|second|third|next|recent|real|best|worst|surprising|interesting|key|important)\b[\w\s-]{0,20}[:.]/gi,
    ),
  },
  {
    id: "x-is-dead",
    name: "“X is dead”",
    description: "This is an “X is dead” obituary headline. Say what changed and what replaced it.",
    find: makeRegexFinder(/\b[\w\s]{3,30}\s+(?:is|are)\s+dead\b|\blong\s+live\s+\w+/gi),
  },
  {
    id: "x-not-y",
    name: "“X, not Y” contrast",
    description:
      "This is an “X, not Y” contrast setting something against its negation. State what it is, not what it is not.",
    find: makeRegexFinder(
      /\b(?!(?:is|are|was|were|am|be|has|have|had)\b)[\w'-]+\s+(?:the|a|an|our|their|its)\s+[\w'-]+(?:\s+[\w'-]+){0,2},\s+not\s+(?:the|a|an|our|their|its)\s+[\w'-]+(?:\s+[\w'-]+){0,2}\b/gi,
    ),
  },
  {
    id: "thats-why-mattered",
    name: "“That’s why X mattered”",
    description:
      "This is retroactively assigning significance to a past choice. State the cause and its effect plainly.",
    find: makeRegexFinder(
      /\b(?:that|this)(?:['\u2019]s|\s+(?:is|was))\s+why\b[^.!?\n]{0,80}?\b(?:matter(?:s|ed)?|count(?:s|ed)?)\b/gi,
    ),
  },
  {
    id: "stranded-auxiliary",
    name: "Stranded auxiliary contrast",
    description:
      "This is a clause that lands on a bare auxiliary for the reversal. Spell out the contrast in full.",
    find: makeRegexFinder(
      /[;:,]\s+[^.;:!?\n]{2,50}\s(?:did|does|do|was|were|is|are|has|have|had|can|could|would|will)(?:n['\u2019]t)?\s*[.;]|\b(?:Maybe|Perhaps)\s+\w+[^.!?\n]{0,40}\s(?:would|could|might|should|did|had|was|is)(?:n['\u2019]t)?\s+(?:have\s*)?\./g,
    ),
  },
  {
    id: "ai-vocab",
    name: "AI vocabulary words",
    description:
      "This is a word that AI text leans on far more than people do. Use the plain word instead.",
    minHits: 2,
    find: makeRegexFinder(
      /\b(?:delv(?:e|es|ed|ing)|tapestr(?:y|ies)|meticulous(?:ly)?|pivotal|intricate(?:ly)?|intricacies|interplay|underscor(?:e|es|ed|ing)|garner(?:s|ed|ing)?|bolster(?:s|ed|ing)?|vibrant|bustling|multifaceted|seamless(?:ly)?|commendable|ever-evolving)\b/gi,
    ),
  },
  {
    id: "vocab-rare",
    name: "AI Tics",
    description:
      "This is suspect language choice that may obstruct true meaning. Prefer plain terms.",
    minHits: 1,
    find: makeRegexFinder(
      /\b(?:load-bearing|re-derived|mutation-checked|pre-fix|mutation-verified|re-measured|byte-identical|bit-identical|re-verified)\b|\bhonestly[?,]/gi,
    ),
  },
  {
    id: "vocab-stance",
    name: "Rigour adverbs",
    description:
      "This is an adverb asserting certainty or evidentiary weight where a plain statement would do. Drop the adverb and state the fact it decorates.",
    find: makeRegexFinder(
      /\b(?:provably|empirically|vacuously|structurally|legitimately|verbatim)\b/gi,
    ),
  },
  {
    id: "vocab-epistemic",
    name: "Claims and evidence vocabulary",
    description:
      "This is the language of assertion, refusal and contradiction. State the claim and the evidence directly instead of gesturing at an argument.",
    find: makeRegexFinder(
      /\b(?:refus(?:e|es|ed|ing|al|als)|assert(?:s|ed|ing)|premis(?:e|es)|asymmetr(?:y|ies)|falsif(?:ied|ies|ying|y)|refut(?:e|es|ed|ing)|contradict(?:s|ed|ing)|verdicts?)\b/gi,
    ),
  },
  {
    id: "vocab-metaphor",
    name: "Mechanical-metaphor nouns",
    description:
      "This is imprecise systems imagery used to dress up plain facts. Name the concrete thing instead.",
    find: makeRegexFinder(
      /\b(?:seams?|backstops?|throwaway|machiner(?:y|ies)|wedge(?:s)?|latent|inert|substrates?|phantoms?|affordance\w*)\b|\b(?:a|an|the|this|that|new|such|whole|entire|different)\s+constructs?\b/gi,
    ),
  },
  {
    id: "vocab-survival",
    name: "Survival and persistence verbs",
    description:
      "These are narrative verbs that treat ideas as living things. Say what happened and why.",
    find: makeRegexFinder(/\b(?:surviv(?:e|es|ed|ing)|restat(?:e|es|ed|ing)|mattered)\b/gi),
  },
  {
    id: "vocab-stance-2",
    name: "Common rigour adverbs",
    description: "This is a common stance adverb. Keep it only if it changes the meaning.",
    minHits: 2,
    find: makeRegexFinder(
      /\b(?:genuinely|deliberately|plainly|outright|silently|quietly|precisely|merely|honest(?:ly)?|honesty|truthfully|truthful)\b/gi,
    ),
  },
  {
    id: "vocab-metaphor-2",
    name: "Common mechanical metaphors",
    description:
      "This is a common systems noun that is an ordinary word in technical prose. Use the literal word when that is what is meant.",
    minHits: 2,
    find: makeRegexFinder(
      /\b(?:ceilings?|floors?|lever(?:s)?|headroom|ratchets?|siblings?|twins?|lone)\b/gi,
    ),
  },
  {
    id: "vocab-survival-2",
    name: "Common persistence verbs",
    description:
      "This is a common persistence verb. Say what was established, not that it was established.",
    minHits: 2,
    find: makeRegexFinder(/\b(?:settled|settles|proves|proven|persisted|persists)\b/gi),
  },
  {
    id: "not-just",
    name: "“Not just X, but Y”",
    description:
      "This is a “not just X, but Y” / “not only … but …” negative parallelism. State both facts without the rhetorical frame.",
    find: makeRegexFinder(
      /\bnot\s+(?:just|only|merely|simply)\s+[^.!?\n;]*?\bbut(?:\s+also)?\b|\b(?:it|this|that)(?:['\u2019]s|\s+(?:is|was))\s+not\s+[^.!?\n,;\u2014\u2013]{1,60}[,;\u2014\u2013]\s*(?:it|this|that)(?:['\u2019]s|\s+(?:is|was))\b/gi,
    ),
  },
  {
    id: "note-that",
    name: "“It’s important to note”",
    description:
      "This is didactic hedging that calls attention to the fact itself. State the fact and drop the hedge.",
    find: makeRegexFinder(
      /\bit(?:['\u2019]s|\s+(?:is|was))\s+(?:also\s+)?(?:important|worth|crucial|essential|vital)\s+(?:to\s+(?:note|remember|understand|recognize|mention|pause|consider|ask)|noting|mentioning|remembering|pausing|considering|asking)\b(?:\s+that\b)?|\bit\s+should\s+be\s+noted\b/gi,
    ),
  },
  {
    id: "testament",
    name: "“Stands as a testament”",
    description:
      "This is a “stands as a testament” frame that inflates significance instead of saying what happened. Say what happened and what it shows.",
    find: makeRegexFinder(
      /\b(?:stand|stands|stood|serve|serves|served|standing|serving)\s+as\s+(?:a|an)\s+(?:\w+\s+)?(?:testament|reminder)\b|\b(?:is|was|are|were|remain|remains)\s+a\s+(?:\w+\s+)?testament\s+to\b/gi,
    ),
  },
  {
    id: "crucial-role",
    name: "“Plays a crucial role”",
    description: "This is a “plays a crucial role in …” claim. Say what it actually does.",
    find: makeRegexFinder(
      /\bplay(?:s|ed|ing)?\s+(?:a|an)\s+(?:\w+\s+)?(?:crucial|pivotal|vital|key|significant|central|critical|important)\s+role\b/gi,
    ),
  },
  {
    id: "landscape",
    name: "“Ever-evolving landscape”",
    description: "This is scene-setting boilerplate. Name the field and what is changing.",
    find: makeRegexFinder(
      /\b(?:ever-)?(?:evolving|changing|shifting)\s+landscape\b|\bin\s+today['\u2019]s\s+(?:fast-paced|ever-changing|ever-evolving|digital|modern|competitive)\s+\w+/gi,
    ),
  },
  {
    id: "vague-experts",
    name: "“Experts argue”",
    description:
      "This is vague attribution to unnamed authorities. Name the source, or drop the attribution and state the claim.",
    find: makeRegexFinder(
      /\b(?:many|some|several|most|numerous)?\s*(?:experts|critics|observers|scholars|analysts|commentators)\s+(?:have\s+|often\s+|widely\s+)?(?:argu(?:e|es|ed)|not(?:e|es|ed)|suggest(?:s|ed)?|believ(?:e|es|ed)|agree[ds]?|contend(?:s|ed)?|observ(?:e|es|ed)|caution(?:s|ed)?|claim(?:s|ed)?|cit(?:e|es|ed)|point(?:s|ed)?\s+out)\b|\bindustry\s+reports?\s+(?:suggest|indicate|show)\w*\b/gi,
    ),
  },
  {
    id: "despite-challenges",
    name: "“Despite these challenges”",
    description:
      "This is the boilerplate challenges-and-outlook formula. State the obstacle and the outcome plainly.",
    find: makeRegexFinder(
      /\bdespite\s+(?:these|those|such|its|their|the|numerous|significant|ongoing)\s+(?:\w+\s+)?challenges\b|\bfac(?:e|es|ed|ing)\s+(?:several|numerous|many|significant|various|a\s+number\s+of)\s+challenges\b|\bchallenges\s+remain\b|\bremains\s+to\s+be\s+seen\b|\b(?:only\s+)?time\s+will\s+tell\b/gi,
    ),
  },
  {
    id: "participle-tail",
    name: "Participle sentence tails",
    description:
      "This is superficial analysis bolted onto a sentence end. Make it a separate sentence with a concrete subject and verb.",
    find: makeRegexFinder(
      /,\s+(?:highlighting|underscoring|emphasizing|showcasing|reflecting|demonstrating|illustrating|signaling|solidifying|cementing|reinforcing|underlining)\s+(?:its|his|her|their|our|the|a|an|how|that|what|both)\b[^.!?\n]*/gi,
    ),
  },
  {
    id: "promo",
    name: "Promotional boilerplate",
    description:
      "This is travel-brochure tone. Describe the thing factually: size, location, price, features.",
    find: makeRegexFinder(
      /\bnestled\s+(?:in|on|among|between|along|at)\b|\bin\s+the\s+heart\s+of\b|\brich\s+(?:cultural\s+|historical\s+)?(?:heritage|history|tapestry)\b|\bhidden\s+gem\b|\bmust-(?:visit|see|try)\b|\bbreathtaking\b|\bboasts?\s+(?:a|an|the)\b|\bstunning\s+(?:views?|scenery|architecture|backdrop)\b/gi,
    ),
  },
  {
    id: "ai-leftovers",
    name: "Chatbot leftovers",
    description:
      "These are artifacts pasted straight from a chatbot. Delete the artifact; it is not part of your answer.",
    find: makeRegexFinder(
      /\bas\s+an\s+ai(?:\s+language)?\s+model\b|\bas\s+of\s+my\s+last\s+(?:update|training)\b|\bknowledge\s+cutoff\b|\bI\s+(?:cannot|can['\u2019]t|do\s+not|don['\u2019]t)\s+(?:browse\s+the\s+internet|access\s+real-?time)\b|contentReference|oaicite|turn0(?:search|news|image)\d*|attributableIndex|utm_source=/gi,
    ),
  },
];
