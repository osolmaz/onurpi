---
name: plain-writing
description: Use when writing or editing prose for readers, including blog posts, documentation, READMEs, reports, and notes. Replaces jargon, coined phrases, and dressed-up wording with plain words unless the technical term is genuinely required, and carries the general rules for titles and headings, Markdown formatting, sentence-level voice, and prose around displayed formulas.
---

# Plain Writing

When this skill is invoked, write with plain words.

This skill is the document-length counterpart of `amk`. That skill
shapes short chat answers. This one governs word choice in anything written
for readers, at any length. The single rule is that every word should be the
plainest word that says the thing correctly. Jargon is allowed only when it
is the established name for the thing and no plain word replaces it without
losing the meaning.

## The core test

For each phrase, ask whether a knowledgeable person would say it out loud to
a colleague at a whiteboard. Nobody says "behind the calculator sits a
mathematical contract". They say "here is the math the calculator runs".
Write the second one.

A term passes the test when it is the accepted name for a real thing:
"KV cache", "bandwidth", "batch size", "mixture-of-experts". These stay,
because replacing them would force a paraphrase that is longer and less
precise. A term fails the test when it exists to make a plain idea sound
deeper: a formula becomes a "contract", checking becomes "validating against
ground truth", using becomes "leveraging". These go.

## What to remove

**Coined dress-up phrases.** Do not invent a fancy name for a plain idea.

- Bad: "Behind the calculator sits a mathematical contract."
- Good: "This post explains the math the calculator runs."

- Bad: "The theory earns its keep on real hardware."
- Good: "Now check the theory against real hardware."

- Bad: "Serving is the business of keeping feasible workloads resident."
- Good: "Serving means keeping sessions in memory and streaming data for them."

**Inflated verbs.** Use the verb a person would actually say.

- Bad: "The pipeline orchestrates the validation stages."
- Good: "The pipeline runs the checks in order."

- Bad: "It leverages the existing cache."
- Good: "It uses the existing cache."

**Abstract nouns doing a verb's job.** Prefer the action to the noun built
from it.

- Bad: "This enables the amortization of weight traffic across the batch."
- Good: "The batch shares one sweep of the weights."

**Grand framing.** Do not promote a step into a philosophy.

- Bad: "This is the mathematical foundation upon which the entire
  methodology rests."
- Good: "Everything below uses this formula."

**Borrowed authority words.** Words like "rigorous", "principled",
"robust", "holistic", and "systematic" claim quality instead of showing it.
Show the property or drop the word.

- Bad: "We take a principled, rigorous approach to estimating traffic."
- Good: "We count every byte the decoder must move and nothing else."

## What to keep

Keep the established term when it names something real and specific, and
define it in one plain sentence at first use if the audience may not know
it.

- Good: "The KV cache is the per-conversation state the model keeps in
  memory. It grows with context length."

Keep exact numbers, units, and names. Plain writing is concrete writing,
and concreteness comes from named things and measured quantities, never
from decoration.

## Context before new information

Give the reader the context they need before each new piece of knowledge, not
after and not never. Every new concept, name, or claim should land on ground
the document has already laid. The reader does not share your head: they have
not seen the project, the conversation, or the drafts that came before, so
anything you know that the text has not yet said is invisible to them.

Do not refer to a thing before introducing it. Phrases like "the math below",
"the calculator", or "the fix" assume the reader already knows what thing is
meant, why it exists, and where it came from. Introduce the thing first, in
one or two sentences: what it is, who made it or where it comes from, and why
it is being brought up now. Then build on it.

- Bad (opening a post): "Nothing in the math below cares whether the machine
  is a MacBook or a datacenter node." The reader does not yet know there is
  math, what it computes, or why they should care.
- Good: "I built Local Frontier, a database that compares local AI hardware.
  This post derives the math it runs. Nothing in that math cares whether the
  machine is a MacBook or a datacenter node."

The same rule applies at every scale. A section that uses a term defined
three sections ago after a long gap should re-anchor it in a few words. A
sentence that drops a new named thing (a tool, a paper, a machine, a person)
should say in passing what it is. One sentence of context is usually enough,
and the test is that a reader who started from the top can follow every
sentence without information they were never given.

## Prose around formulas

No section may become a dump of formulas, theorem statements, or definitions one
after another.

Every displayed formula must be introduced by prose that says why it appears,
what problem it addresses, or what the reader should notice. After a displayed
formula, add prose that interprets it, names the important terms, explains the
transition, or states what has been gained, unless the formula is an immediate
continuation of the same short derivation.

Long derivations must be broken into stages. Between stages, explain the goal,
the invariant, the simplification, or the reason the next manipulation is valid.
The reader should be able to follow the conceptual path from the surrounding
paragraphs before checking every algebraic detail.

Use formulas as load-bearing parts of the exposition, not as a replacement for
exposition.

## Markdown formatting

When writing Markdown, use clean semantic headings without manual section
numbers.

Write:

```markdown
## Dennard Formulation
## KV-Aware Bounds
```

Do not write:

```markdown
## 1. Dennard Formulation
## 2. KV-Aware Bounds
```

Let the renderer, table of contents, or surrounding publication system provide
numbering when numbering is needed. Use ordered lists for actual ordered steps,
procedures, or exercise lists, not for section titles.

Only preserve manual numbering in headings when the user explicitly asks for it,
or when rewriting an existing source whose section numbers must remain stable
for citation or cross-reference.

## Title formatting

Make headings labels, not sentences. A heading names the topic of its section as
a noun phrase — "Capacity limit", "Dense transformer", "Worked examples" — so the
reader can scan the structure. A full subject-verb-object heading ("Capacity caps
the batch") pre-empts the section and reads as a slogan, the more so when several
sibling headings are stamped from one parallel template.

Use sentence case, not Title Case. Capitalize only the first word, proper nouns,
and specific coined terms; lowercase the rest. Keep eponymous or named constructs
in their canonical form (Dennard Ceiling, KV-Aware Bound, DGX Spark) and acronyms
uppercase (KV, MoE, LLM). So "The Memory-Fit Batch" becomes "Memory-fit batch"
and "The Usable-Batch Correction" becomes "Usable-batch correction". A leading
article is fine when it reads naturally ("A toy decoder").

Do not make "The" a reflexive prefix. Drop a rote leading "The" from a
noun-phrase label ("The capacity limit" → "Capacity limit"); keep it only when
the heading is a full clause that would read wrong without it ("The loose bound is
too generous").

Prefer a plain declarative heading to a rhetorical frame, and do not repeat one
frame down the outline. A run of "Why X" or "How Y" headings is a smell: turn
"Why the Loose Bound Is Too Generous" into "The loose bound is too generous".

The exception is a deliberate major statement. A heading may be a full sentence
when that sentence is a load-bearing claim the section exists to defend — a named
law, or a thesis like "Memory power is the wrong metric for latency". Use it
rarely: in a document whose headings are otherwise noun phrases, a sentence
heading should earn its emphasis, and two of them in a row almost never do.

After drafting, read the document's headings as a flat list and check that they
are the same kind of thing, labels with labels, in one register and one casing.

## Sentence-level voice

State claims positively. Avoid the negation-contrast reframe — "it is not X, it
is Y", "not X but Y", "X isn't about Y, it's about Z", "the point isn't X, it's
Y". This antithesis construction is a recognizable marker of machine-generated
prose, and it forces the reader to hold a clause (X) that the sentence
immediately throws away. Say Y directly.

Rewrite the reframe into a plain assertion:

- "It is not a benchmark predictor. It is a roofline." becomes "It is a
  roofline."
- "The product appears not because we multiplied two specs, but because
  throughput factors into parallelism times step rate." becomes "The product
  appears because throughput factors into parallelism times step rate."
- "This is a batched-throughput statement, not a latency statement." becomes
  "This governs batched throughput." — then show the degenerate case directly.

A plain negation is fine when the negation is the content: a genuine
non-equivalence ("fitting in memory does not imply serving usefully"), a
disambiguation between two real quantities, or a warning about a real
misconception. Use it once, plainly, without the paired "it is Y" reveal that
turns the fact into a rhetorical move.

## How to apply

Write the draft, then sweep it phrase by phrase. For every phrase that
sounds impressive, ask what it literally says, and say that instead. If two
candidate words mean the same thing, pick the shorter and more common one.
If a sentence survives only because its wording sounds good, delete it and
check whether anything is missing. Nothing usually is.
