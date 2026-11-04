---
name: data-model
description: Use when designing, creating, reviewing, or changing a data model of any kind, including database tables, SQL schemas and migrations, ORM models, JSON schemas, API request and response payloads, event payloads, stored JSON or YAML files, and config formats. Sets the default rules for primary keys, display names and slugs, created, updated and deleted timestamps, column and key naming, value types, constraints, history, API shapes, and migrations, with a checklist to run before writing a migration.
---

# Data Model

A data model lives longer than the code that first uses it. A wrong key or a vague column name costs one line
to avoid on the first day and a migration of every table, file and link to fix later. These rules are the
defaults for every new table, document, payload and file format. They apply to SQL databases, document stores,
JSON and YAML files, and API payloads alike; where the words differ, a row, a document and an object are the
same thing here, a record.

[references/examples.md](references/examples.md) has complete PostgreSQL and SQLite tables, an append-only
table, a revision table, a stored JSON document, API payloads, and the migration that moves a table from a
name key to a UUID key.

## Workflow

1. Read the existing schema, the migrations, the ORM models, the API types and the repository's own rules
   before you add anything.
2. Write the new tables, fields or payloads with the rules below.
3. Run the [checklist](#checklist) on every new or changed table and document before you write the migration.
4. In an existing schema that breaks a rule, apply the rule to every new table and field anyway. Report each
   old violation with the migration that would fix it, and fix it only when the user asks. Do not mix two
   conventions inside one table.
5. When the change adds a table, changes a key or removes data, show the schema to the user before you write
   the migration.

## Identity

- Every record has `id` as its primary key, and `id` is a UUID. Use UUIDv7: it sorts by creation time, so
  B-tree indexes stay compact and new rows land at the end. Generate it in the application (`v7()` from the
  `uuid` npm package, `uuid.uuid7()` in Python 3.14 and later) or in the database (`uuidv7()` in PostgreSQL 18
  and later). Use UUIDv4 only where no v7 generator exists.
- Never use a name, title, slug, email, username, file path, or any other value that a person can change or
  that carries meaning as a primary key. The same holds for anything that other records, files or systems
  point at.
- Every reference uses the `id`: foreign keys, join tables, storage paths (`files/<id>/`), cache keys, queue
  messages, event payloads and logs. A rename then changes one column of one row.
- An `id` carries no meaning. No code parses it, sorts by it for display, or builds it from other fields.
- When people need a short number to say or type, add a `number` column: an integer, unique, taken from a
  sequence or a counter row, and shown with a prefix such as `INV-1042`. It is a label like a name; other
  records still reference `id`.
- A join row that only links two records has the composite primary key of the two references
  (`project_id`, `user_id`) and `created_at`. When the link has its own fields or its own lifecycle, such as a
  role or an end date, it is a record and gets its own `id`.
- In a system with more than one tenant, every table that a tenant owns has the tenant's id column
  (`organization_id`), indexed, and every query filters on it.

## Names and labels

- `display_name` is what people see. It is free text, not unique, and it can change at any time. Use it for
  every record that people name: users, projects, teams, sets, files.
- `slug` is a typed handle for URLs and command lines, and only when one is needed. It is lowercase letters,
  digits and hyphens, unique among live records, and it can change. Nothing references a slug. When it
  changes, the old slug stops working; do not keep aliases.
- A person has `display_name`. Do not split it into first and last names unless a process really needs the
  parts, and add `legal_name` only when a law or a contract needs it.
- Compare emails and handles without case: put the unique index on the lowercased value, and keep the value
  as it was entered.
- A rename is an update of `display_name` or `slug`. It never changes a key, a path or a reference.

## Timestamps and lifecycle

Every record that can change carries these columns:

| Column | Set when | Notes |
| --- | --- | --- |
| `created_at` | the record is made | Never changes. |
| `created_by_id` | the record is made | The user who made it; NULL only when no user did, such as a sign-up or a system job, and the docs say which. |
| `updated_at` | every change | Equal to `created_at` on a new record. |
| `updated_by_id` | every change | |
| `deleted_at` | soft delete | NULL while the record is live. |
| `deleted_by_id` | soft delete | |
| `revision` | every change | An integer that starts at 1; see [concurrent edits](#concurrent-edits). |

- Set `updated_at`, `updated_by_id` and `revision` in one place: a trigger, or the one store function that
  writes the table. Never leave it to each caller.
- Records are not removed in normal operation. A delete sets `deleted_at` and `deleted_by_id`; a restore sets
  them back to NULL. Every normal read filters on `deleted_at IS NULL`, and only an explicit "deleted" view
  shows the rest.
- Add `archived_at` when the product needs a record that is out of the default lists but still opens on
  direct access and can come back. Archive and delete are two states; do not use one column for both.
- Decide what a delete does to the children of a record: refuse while live children exist, set the same
  `deleted_at` on them, or leave them. Write the choice in the schema docs.
- When a law or a person's request requires erasure, overwrite the personal fields, keep the row and its `id`,
  and record who erased it, when and why. Keep personal data in few columns so that this stays possible.
- An append-only record never changes after it is written: events, revisions, notes, votes, audit entries,
  ledger entries. It has only `created_at` and `created_by_id`, because `updated_at` and `deleted_at` would
  always be empty. A correction is a new record. The database refuses updates and deletes with a trigger.
- A state with a date is a timestamp: `published_at`, `archived_at`, `closed_at`. A record that moves through
  more than two states has a `status` enum. Use both when you need the state and the date it began. Never
  model a state as a boolean such as `is_archived`: a boolean loses the date, and two booleans can contradict
  each other.

### Concurrent edits

Every update sends the `revision` that the writer read. The store increments it and refuses the write when the
stored revision differs, so two people editing the same record cannot overwrite each other without notice.
The API answers a refused write with a conflict error that says the record changed.

## Naming

- Use `snake_case` for tables, columns, and JSON keys that are stored or sent over an API. When the code uses
  `camelCase`, convert mechanically at one boundary and never change the words.
- Table names are plural (`users`, `order_items`) and column names singular. A join table names both sides
  (`project_members`).
- Use `type` for what a record is, never `kind`, `variant`, `sort` or `class`. Use `status` for where it is in
  its lifecycle. Both are enums.
- Use one word for one concept in the whole system: tables, columns, API fields, code, UI text and docs. If it
  is a `user`, it is not also a `member`, `account` or `person` somewhere else.
- A reference ends in `_id`: `owner_id`, `created_by_id`. When a table points at the same table twice, the
  names say the roles: `sender_id`, `recipient_id`.
- A suffix gives the meaning and the unit:

  | Suffix | Holds | Example |
  | --- | --- | --- |
  | `_at` | a timestamp in UTC | `created_at` |
  | `_on` | a date without a time | `due_on` |
  | `_count` | a count | `attempt_count`, not `num_attempts` or `n_attempts` |
  | `_seconds`, `_ms` | a duration | `timeout_seconds` |
  | `_bytes` | a size | `size_bytes` |
  | `_minor_units` | money in the currency's smallest unit | `price_minor_units` with `price_currency` |
  | `_rate`, `_ratio` | a fraction from 0 to 1 | `pass_rate` |
  | `_percent` | a value from 0 to 100 | `discount_percent` |
  | `_url` | an absolute URL | `avatar_url` |

- A boolean starts with `is_`, `has_` or `can_` and names the positive case: `is_visible`, not `hidden` or
  `is_not_visible`. Use a boolean only for a true yes or no that has no date and no third value.
- Do not repeat the table name in its columns: `tasks.title`, not `tasks.task_title`.
- Do not abbreviate. `description`, not `desc`; `quantity`, not `qty`; `config`, not `cfg`. Keep only the
  abbreviations that everyone uses: `id`, `url`, `uuid`, `ip`, `api`.
- Do not use vague words: `data`, `info`, `details`, `misc`, `extra`, `other`, `meta`, `payload`, `stuff`,
  `value` on its own. Name what the column holds.
- Do not put the data type in the name: `tags`, not `tags_list`; `name`, not `name_str`.
- Do not use words that SQL reserves, such as `order`, `user`, `group`, `key`, `default`, as table or column
  names; they need quotes everywhere. `position` replaces `order`, and plural table names avoid the rest.

## Values and types

- An enum is stored as lowercase `snake_case` text (`in_review`, not `2` or `InReview`), and both the
  database (a `CHECK` or an enum type) and the API schema refuse other values. Add values freely. Never rename
  a value in place or give a removed value a new meaning: add the new value, migrate the rows, then remove the
  old one.
- Columns are NOT NULL with a default wherever a default makes sense. Where NULL is allowed, the docs say what
  it means: "unknown" or "does not apply". Never use both `''` and NULL for the same meaning. Never use a
  nullable boolean as a three-way state; use an enum.
- Money is an integer in the currency's smallest unit plus an ISO 4217 currency code column. Never store money
  as a float. Exchange rates and prices per unit that need fractions use a decimal type.
- A fraction uses one scale for the whole system: 0 to 1 for `_rate` and `_ratio`, 0 to 100 only for
  `_percent`.
- Timestamps are UTC. In PostgreSQL use `timestamptz`. In SQLite and in JSON use ISO 8601 text with
  milliseconds and `Z`: `2026-01-15T09:30:00.000Z`. For an event at a local time, such as a meeting at 09:00
  in Berlin, store the local time and the IANA zone name (`Europe/Berlin`) as well, because the offset of a
  zone changes.
- A date without a time is a `date` column, or `YYYY-MM-DD` text, and its name ends in `_on`.
- A duration is an integer with its unit in the name. Do not store `"5m"` or an interval string.
- In JSON, every `id` is a string, and every integer that can exceed 2^53 is a string, because JavaScript
  loses precision above it.
- Where the product has a length limit, the database checks it too.

## Structure

- Keep one fact in one place. Do not store a value that you can calculate from other columns, such as a
  total, a count or an age. If you cache one for speed, name its source in the schema docs and update it in
  the same transaction as the source.
- Never put a list into a text column (`"a,b,c"`). Use a join table, or a JSON array when the value is really
  part of a document.
- Use a JSON column only for data that no query filters, sorts or joins on, and validate it with a schema. If a
  query needs a value, it gets its own column.
- The database enforces the rules, not only the code: foreign keys, unique constraints, `CHECK` constraints and
  NOT NULL. Foreign keys use `ON DELETE RESTRICT`, because records are soft-deleted. SQLite enforces foreign
  keys only after `PRAGMA foreign_keys = ON` on each connection; use `STRICT` tables there.
- Index every foreign key and every column that a frequent query filters or sorts on.
- A unique constraint on a field that people set (a slug, an email) covers live records only:
  `UNIQUE ... WHERE deleted_at IS NULL`. Otherwise a deleted record keeps its value reserved forever.
- Variants that share most of their fields are one table with a `type` column. Variants that share only a few
  fields are separate tables. Never use attribute-value tables, where each row holds one field of a record.
- Do not make polymorphic references (`subject_type` and `subject_id`), because no foreign key can check them.
  Give the table one nullable foreign key per target table and a `CHECK` that exactly one of them is set.
- A list in an order that people choose has a `position` column. Never rely on insert order or `id` order to
  show it.
- When you need to know who changed what, keep an append-only revision table (`project_revisions`) with the
  record's id, the revision number, the changed fields with their old and new values, `created_at` and
  `created_by_id`. Do not overwrite the row and lose the old value.
- Never store a password or an API token in plain text. Store a password as an argon2id hash (bcrypt where
  argon2id is not available). Store an API token as a SHA-256 hash plus a short visible prefix that identifies
  it, and show the full token once, when it is made.
- Every stored file and JSON document has an integer `schema_version` at its top level. A reader refuses a
  version that it does not know. Increase it when the shape changes.

## APIs

- Use the same names in the store, the API and the code.
- An object in a response carries its `id`, its timestamps and its `revision` as the store has them, with
  timestamps as ISO 8601 strings and ids as strings.
- A list is an object, never a bare array: `{"items": [...], "next_cursor": "..."}`, with `next_cursor` null
  on the last page. Then fields such as a total can be added later. Page with a cursor, not an offset, over a
  stable order such as `created_at` and then `id`.
- A create or an update returns the whole object as stored.
- A partial update sends only the changed fields and the `revision` that the client read.
- An error has a stable machine-readable `code` and a message for people:
  `{"error": {"code": "revision_conflict", "message": "..."}}`.

## Migrations

- Never edit a migration that has run anywhere. Add a new one.
- Back up the store and rehearse the migration on a copy of the production data before you run it on
  production.
- Run each migration in a transaction where the database allows it. PostgreSQL and SQLite run DDL in a
  transaction; MySQL does not.
- Make a hard cutover: one migration moves the data and removes the old shape. Do not leave old columns,
  aliases, dual writes or readers for the old shape behind. When a running service cannot stop for the
  migration, add the new shape, backfill it, switch reads and writes, and remove the old shape in the next
  release, not later.
- Never give an existing column or enum value a new meaning. Add the new one, migrate the data, and remove the
  old one.
- Backfill a large table in batches, and compare row counts and spot-check values before you remove the old
  column.
- To move a table from a name key to a UUID key: add `id` and fill it, add the new `_id` columns to every
  referencing table and fill them through the old key, move the primary key and the foreign keys to the new
  columns, drop the old reference columns, turn the old name into `slug` or `display_name`, then move storage
  paths and code to the `id`. [references/examples.md](references/examples.md) has the SQL.

## Checklist

Run this on every new or changed table, document and payload before you write the migration. Each answer must
be yes, or the schema docs must say why not.

- Is the primary key `id`, a UUID, with no meaning?
- Do all references, storage paths and cache keys use `id`, never a name or a slug?
- Does every record that can change have `created_at`, `created_by_id`, `updated_at`, `updated_by_id`,
  `deleted_at`, `deleted_by_id` and `revision`? Does every append-only record have only `created_at` and
  `created_by_id`, with updates and deletes refused?
- Is what people see in `display_name`, and is a handle, if any, a changeable `slug` that nothing references?
- Is every state a timestamp or an enum, not a boolean?
- Does every name follow the [naming](#naming) rules: `snake_case`, `type` not `kind`, `_id` on references,
  the right suffix and unit, no abbreviations, no vague words, no SQL reserved words?
- Is money an integer in minor units with a currency? Are timestamps UTC, and dates `_on`?
- Does the database enforce the foreign keys, unique constraints, checks and NOT NULL, and is each foreign key
  indexed?
- Do unique constraints on fields that people set cover live records only?
- Is every fact stored once, with no lists in text columns and no queried values inside JSON?
- Does every stored file or document have `schema_version`?
- Is the migration new, rehearsed on a copy, in a transaction, and a hard cutover?
