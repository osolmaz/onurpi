---
name: write-monograph
description: Use when planning, drafting, revising, or reviewing a mathematical or technical monograph, lecture-note sequence, long-form tutorial, or textbook chapter. Helps build exposition from motivation to formal definitions, propositions, proofs, examples, applications, questions, exercises, and solutions without dumping unexplained formulas or inventing facts to fit a template.
---

# Write Monograph

Use this skill to write rigorous long-form technical exposition that teaches a
subject by building it in layers.

The goal is not to make the text easy by removing rigor. The goal is to make
rigor feel inevitable: each definition, theorem, notation choice, proof, example,
algorithm, and exercise should answer a need the reader has already seen.

## General Prose Rules

Apply the `plain-writing` skill alongside this one. It carries the general
rules that used to live here: prose around displayed formulas and staged
derivations, Markdown heading formatting, title formatting, and
sentence-level voice.

## Heuristic, Not A Template

The structure in this skill is a suggested teaching pattern, not a strict
formula.

Do not invent definitions, examples, applications, historical motivation,
theorems, citations, exercises, or domain facts just to satisfy this pattern. If
the source material does not support a section, write a narrower true section,
say what is missing, or ask for the needed source/context.

Truth, source fidelity, and mathematical correctness come before matching the
recommended sequence. Drop, merge, or reorder steps when the subject demands it.

## Reader Contract

Write for a serious learner who is willing to work but does not yet know why the
next abstraction is necessary.

Before introducing a formal object, give the reader at least one of these:

- a concrete problem that cannot be solved cleanly without it
- a familiar lower-dimensional or smaller case
- a computational inconvenience that the abstraction removes
- a theoretical gap left by the previous section
- a real application that forces the new concept to appear

Avoid definitions that arrive as isolated declarations. A definition can be
formal and compact, but the reader should know what pressure created it.

## Global Shape

Use a staged sequence from concrete to abstract to operational.

1. Start with a motivating overview.
2. Begin the first chapter from familiar examples, history, geometry, computation, or an application.
3. Distill the shared structure into definitions.
4. Develop consequences through propositions and theorems.
5. Show how the formalism acts on examples.
6. Turn recurring proof or computation patterns into practical methods.
7. Close chapters with conceptual questions, exercises, and solutions or solution sketches.
8. Let later chapters reuse previous structures instead of restarting from scratch.

For a mathematical monograph, a reliable progression is:

- concrete objects and operations
- subobjects and closure conditions
- generation, independence, coordinates, and bases
- structure-preserving maps
- representations of maps by symbolic or computational objects
- operations on those representations
- algorithms and applications

For a non-mathematical technical monograph, keep the same pattern but translate
the nouns: primitives, valid substructures, composition, canonical
representations, transformations, algorithms, case studies.

## Chapter Openings

Open each chapter with a small promise, not a table of contents.

Good chapter openings do these things:

- state the new problem or capability
- identify which earlier concept is being extended
- say why the new layer matters in theory or practice
- delay full generality until the reader has a reason to want it

When the chapter is abstract, start with a familiar special case. When the
chapter is computational, start with a real problem or a small worked instance.
When the chapter introduces a representation, explain what information the
representation preserves and what choices it depends on.

## Section Pattern

Most sections should follow this rhythm:

1. Motivation: explain the need in plain technical language.
2. Recall: bring forward only the prior facts needed now.
3. Notation: introduce symbols before they appear in dense formulas.
4. Definition: state the formal object precisely.
5. Immediate consequences: record simple but useful facts.
6. Theorem or proposition: state the reusable result.
7. Proof: prove only what has not already become obvious.
8. Example: compute or test the result in a concrete case.
9. Method: if the example exposes a repeatable process, extract it.
10. Checkpoint: ask a question, leave a small verification, or point to an exercise.

Do not force every section to contain every item. Use the rhythm to prevent
lonely definitions and unsupported examples.

## Definitions

Make definitions short, named, and operational.

Before a definition:

- explain the informal idea
- identify the ambient objects and assumptions
- make clear what problem the definition solves

Inside a definition:

- state the object first
- list required properties in a stable order
- name important special cases
- define all symbols that are local to the definition

After a definition:

- test it on a simple example
- mention an obvious non-example when it prevents a common mistake
- point out which clauses are the ones that must actually be checked

When a long axiom list is unavoidable, immediately compress it into a practical
test or criterion if one exists.

## Notation

Introduce notation just in time and attach meaning to the subscript, superscript,
index, or decoration.

Use notation to reduce cognitive load, not to advertise generality. If an object
depends on choices, say so near the notation. For example, when a representation
depends on a basis, coordinate system, convention, ordering, model, or
normalization, make that dependence explicit before simplifying the notation.

Prefer this order:

1. plain-language role
2. formal symbol
3. dependency or convention
4. simplified symbol used later

Return to the meaning of notation when it reappears after a long gap.

## Theorems And Proofs

State theorems in the form the reader can use.

Before a theorem, give one sentence explaining what it will let the reader do:
test a property, build an object, compute a value, classify cases, or connect two
views of the same structure.

Use proofs to reveal why the statement is true, not just to certify it. Good
proofs in this style often:

- recall the exact earlier criterion being applied
- prove both directions explicitly when the statement is an equivalence
- name the inclusion or implication currently being shown
- reduce a general claim to a generic element
- reuse definitions instead of invoking hidden intuition
- end by stating what has been established

It is acceptable to omit a proof when it would interrupt the main lesson, but say
why it is omitted and use the theorem immediately so the reader sees its value.
Do not omit the proof of a result that is the conceptual hinge of the chapter.

## Examples

Use examples for distinct jobs.

- First example: show the definition in the smallest nontrivial setting.
- Contrast example: show why a plausible false statement fails.
- Computation example: demonstrate a repeatable calculation.
- Choice-sensitive example: show how a result changes when a basis, convention,
  coordinate system, or parameter changes.
- Reverse example: start from the representation and recover the object.
- Application example: connect the theory to a real domain.

After each substantial example, say what the example demonstrates. If the example
contains an unfinished but useful computation, mark it as an exercise and make
sure the required technique has already appeared.

## Practical Methods

When a calculation appears more than once, extract a method box.

Write method boxes as imperative procedures. Keep them short enough to execute.

Include:

- inputs and assumptions
- the ordered steps
- the test for success or failure
- how to interpret the result
- a warning about the most common invalid case

Place method boxes after the motivating theorem and at least one example, unless
the method is the reason the theorem is being introduced.

## Applications

Use applications to justify the theory, not to decorate it.

A good application section should:

- begin with a real question
- translate domain facts into the formal language of the chapter
- solve the formal problem with the tools already built
- translate the result back into the domain
- mention constraints that come from reality rather than the formal model

Keep applications concrete. Electrical networks, chemical balancing,
cryptography, color perception, physical models, algorithms, and data examples
work because they force the abstraction to do visible work.

## Questions And Exercises

End chapters with two different kinds of practice.

Conceptual questions should test whether the reader can recall and explain the
main definitions, criteria, theorem statements, and relationships. Ask for exact
formulations, differences between similar notions, and reasons a method applies.

Exercises should make the reader use the machinery.

Include a mix of:

- definition checks
- proof completions
- small computations
- counterexamples
- construction tasks
- application problems
- reverse-engineering tasks

Order exercises from direct checks to synthesis. If solutions are included,
encourage the reader to attempt the work first, then provide enough detail to
show the method, not merely the answer.

## Revision Checklist

Before considering a chapter ready, check:

- The chapter says what new capability it gives the reader.
- The general prose rules from the `plain-writing` skill hold: formulas are
  framed by prose, headings are unnumbered sentence-case labels, and no
  negation-contrast reframes remain.
- Every major definition is motivated before it is stated.
- Notation is introduced before dense use and dependencies are named.
- Theorems are followed by proofs, examples, or a clear reason for omission.
- Examples are not all of the same type.
- At least one recurring computation has been converted into a practical method.
- Applications are solved by the chapter's tools, not pasted in as anecdotes.
- Questions test concepts; exercises test use.
- Later sections refer back to earlier results by name or role.
- The text does not overgeneralize before the reader has seen the small case.
- The suggested structure has not forced unsupported or fabricated facts.

## Avoid

- Making up motivation, examples, applications, or facts to satisfy the skill's
  suggested structure.
- Starting with a maximally general definition when a familiar case can motivate it.
- Introducing notation only inside a formula and explaining it later.
- Treating examples as optional after a hard theorem.
- Hiding choice-dependence in representations.
- Giving applications that do not use the theory.
- Writing exercises that only repeat the worked examples with new numbers.
- Collapsing proof, computation, and explanation into one unstructured block.
- Making the monograph sound like a survey when it is meant to teach.
