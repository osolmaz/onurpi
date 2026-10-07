---
disable-model-invocation: true
name: postmortem
description: Use when something went wrong in a task and Onur wants it never to happen again — after an incident, a wasted run, a silent wrong turn, or a cost or trust failure. Covers the replay of the failure path, the process-level cause, and landing a durable guardrail in a repo, doc, check, or skill. Not for routine bugs that were fixed and understood.
---

# Postmortem

Something went wrong. The goal of this skill is that it cannot happen the same way again. Not a promise, a change: one guardrail, landed somewhere real, before the work moves on.

## The replay

Before writing anything, replay the path in your head with empathy.

Put a competent agent — or Onur himself, fresh, zero context, tired, in good faith — back on the exact path the failure took. Give them only what they could see at each step: the docs they had, the errors they got, the defaults in front of them, the pressure they were under. Not today's hindsight. Walk the path one decision at a time and find the first fork where the wrong turn was reasonable.

That fork is the finding. Not the last error, not the loudest symptom — the first reasonable-but-wrong decision.

If the wrong turn only becomes visible with hindsight, the guardrail belongs earlier: at the last place where the truth was available and not stated, or not stated loudly enough.

## The rules of the replay

- The agent on the path is never the villain. They had partial docs, plausible defaults, and momentum. If your fix is "pay more attention" or "read more carefully", it is not a fix.
- Under pressure, instructions do not get read. Guardrails get hit. Prefer a change that makes the wrong turn impossible, loud, or self-correcting over one that asks for care.
- Blame the path, not the walker. Say the process failure out loud: the docs that hid the fact, the error that lied, the check that did not exist, the shortcut that had no seatbelt.
- Do not build process theater. The cost of the guardrail must be smaller than the cost of one recurrence. One small landed change beats a checklist nobody reads.
- Stay on the failure path. Do not refactor nearby code, rename things, or fix unrelated smells you passed on the way.

## What to land

Exactly four things, in this order:

1. **What happened** — two or three plain sentences. What was intended, what actually happened, what it cost.
2. **The fork** — the first reasonable-but-wrong decision point, and what made it reasonable at the time.
3. **The guardrail** — the cheapest change that catches the fork next time. In rising order of cost: a better error message that turns a dead end into a signpost; a doc line that states a rule the path needed; a schema or manifest check that fails fast; a skill note for the next agent on this path; a code guard.
4. **Where it lands** — the repo, file, and commit. Land it now. A guardrail left in the conversation did not happen.

Report the four back to Onur in that order, then stop. Do not pad, do not summarize the whole session, do not add action items without owners.

## Tone

Plain, short sentences. Name your own mistakes without cushioning: say "I skipped the contract and let the server teach me", not "the API interaction could have been more structured". The honesty is the point — the replay is only useful if the walker is rendered accurately, and this time the walker was you.
