---
name: consistent-notation
description: Keep mathematical notation consistent with a source document when extending, formulating, reviewing, or porting derivations that build on an existing paper, blog post, spec, or codebase. Trigger on requests to extend a derivation, add a bound or counterpart, formalize a new phase or case of an existing formulation, or check whether new math matches the source notation.
---

# Consistent notation

New math written on top of an existing document tends to drift away from
that document's symbols, and the drift makes the result harder to trust
and harder to merge back. The drift takes four specific forms, and every
rule in this skill exists to block one of them:

- Minting a synonym symbol for a concept the source already names, such
  as introducing $X_P$ for throughput when the source uses $T$.
- Repurposing a source symbol for a different concept, such as reusing a
  speculative-decoding acceptance count as a generic token multiplier in
  a phase where speculation plays no role.
- Introducing a new symbol without pinning it down, such as a $u$ that
  means chunk length per request in one equation and total tokens per
  weight sweep in another, which silently drops a factor of the batch
  size.
- Changing an existing symbol's argument or domain without saying so,
  such as turning $W(b)$ into $W(bL)$ mid-derivation.

## Extract the symbol table first

Before deriving anything, read the source and write out its symbol
table: every symbol, its meaning, its units, and its argument
convention. What a function symbol takes as input matters as much as
what it returns. Work from the actual text, never from memory of it;
drift usually enters through a half-remembered symbol.

Keep the table in the working draft or scratch notes while deriving. It
is the reference for every rule below.

## Rules while deriving

Use the source symbol whenever the concept already exists in the
source. If the throughput, the traffic per token, or the capacity gate
already has a name, that name is the only one allowed.

Never reuse a source symbol for a different concept, however related.
The temptation to reuse one is itself a signal: it usually means the
source concept does not apply in the new setting, and the honest move
is a new symbol with its own definition.

Declare every new symbol at first use, with its meaning, its units, and
its relation to the existing symbols. Follow the source's naming
conventions for subscript style and typography so new symbols read as
native. If the source marks phases or variants with a subscript, mark
the new phase the same way rather than inventing a fresh letter.

When an existing symbol genuinely needs a changed argument or domain,
keep the symbol and state the change in prose at the point of change,
with the reason. A reader comparing the two documents must be able to
find the sentence that authorizes the difference.

Ambiguity about totals and per-item quantities causes the worst bugs.
For any symbol that counts tokens, requests, bytes, or steps, the
declaration must say whether it is per request, per iteration, or a
grand total, and equations must not switch between readings.

## Sweep before finishing

List every symbol used in the draft. A regex over math spans catches
most of them; patterns like a letter followed by a subscript brace find
the compound symbols. Each symbol must appear either in the source
table or in the draft's new-symbol declarations. Then check the mapping
both ways: no symbol carries two meanings, and no meaning is carried by
two symbols.

The strongest single test is the reduction check. Set the new
formulation to the degenerate case the source covers and confirm it
reproduces the source's equation with the same symbols, not a
paraphrase of it. State each reduction explicitly, as in "at $c = 1$
this is the source's decode bound", and compare character by character
against the extracted table. A synonym symbol cannot survive this
check, because the reduced equation will differ from the source in
exactly the renamed position.

If a reduction produces the right structure with different symbols, the
fix is renaming the draft to match the source, never the reverse. The
source document is the notation authority unless the user says
otherwise.
