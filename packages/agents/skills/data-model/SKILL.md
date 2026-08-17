---
name: data-model
description: "Use when creating or revising Lindy data models: durable, simple schemas for JSON files, JSON schemas, API payloads, database schemas, SQL tables, migrations, or any structured set of keys, fields, or columns. Acts as a lightweight wrapper around Schemator and its bundled schemator skill."
---

# Data Model

Use this skill when the goal is to create a Lindy data model: a schema that is
small, durable, boring in the best way, and likely to survive changing product
details because it captures stable concepts instead of temporary assumptions.

This skill is only a wrapper. Schemator is the source of truth for reviewing
schemas, simplifying fields, checking naming, and producing auditable reports.

## How To Use It

1. Use Schemator and its bundled `schemator` skill for the actual workflow. If
   the skill is installed, invoke `$schemator`.
2. Start from a real draft schema or proposal. If no draft exists yet, make the
   smallest useful draft first, then hand it to Schemator.
3. Provide project/task context before review so Schemator can judge names,
   field purpose, constraints, and borrowed vocabulary in context.
4. Run Schemator for extraction, review, simplification, convergence, diffing,
   or reporting as appropriate for the task.
5. Treat Schemator output as a candidate result and do the final human/product
   pass required by the `schemator` skill.

## Schemator Reference

Install Schemator from npm:

```bash
npm install -g @osolmaz/schemator
```

Use the bundled Schemator skill as the detailed instruction source:

```bash
schemator --skill show schemator
schemator --skill export schemator | npx skillflag install --agent codex
```

Do not duplicate Schemator's review rules, report checklist, prompt guidance, or
schema criteria in this skill. Update Schemator and its bundled skills instead.
