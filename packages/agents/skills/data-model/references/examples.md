# Data model examples

Complete examples of the rules in [SKILL.md](../SKILL.md). The domain is a small project tracker: users,
projects, notes on projects, and the revision history of projects. Copy the shape, not the domain.

## PostgreSQL

`uuidv7()` needs PostgreSQL 18 or later. On an older version, generate the UUIDv7 in the application and pass
it in, and drop the `DEFAULT`.

### A record that can change

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  email text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid REFERENCES users (id),  -- NULL: the person signed up
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid REFERENCES users (id),  -- NULL: the person signed up and has not changed anything
  deleted_at timestamptz,
  deleted_by_id uuid REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX users_email_live ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  number integer NOT NULL UNIQUE GENERATED ALWAYS AS IDENTITY,  -- shown as PRJ-<number>
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  type text NOT NULL CHECK (type IN ('internal', 'client')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'done')),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  budget_minor_units bigint NOT NULL DEFAULT 0 CHECK (budget_minor_units >= 0),
  budget_currency text NOT NULL DEFAULT 'EUR' CHECK (budget_currency ~ '^[A-Z]{3}$'),
  starts_on date,  -- NULL: no start date set yet
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  archived_at timestamptz,
  deleted_at timestamptz,
  deleted_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX projects_slug_live ON projects (slug) WHERE deleted_at IS NULL;
CREATE INDEX projects_owner_id ON projects (owner_id);
CREATE INDEX projects_created_by_id ON projects (created_by_id);
CREATE INDEX projects_updated_by_id ON projects (updated_by_id);
CREATE INDEX projects_deleted_by_id ON projects (deleted_by_id);
```

One trigger sets `updated_at` and `revision` on every update, so no caller can forget them:

```sql
CREATE FUNCTION touch_record() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  NEW.revision = OLD.revision + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_record();
```

An update sends the revision that the writer read. No row updated means that someone changed or deleted the
project since then, and the API answers with a `revision_conflict` error:

```sql
UPDATE projects
SET display_name = $1, updated_by_id = $2
WHERE id = $3 AND revision = $4 AND deleted_at IS NULL;
```

A delete and a restore are updates:

```sql
UPDATE projects SET deleted_at = now(), deleted_by_id = $1, updated_by_id = $1
WHERE id = $2 AND deleted_at IS NULL;

UPDATE projects SET deleted_at = NULL, deleted_by_id = NULL, updated_by_id = $1
WHERE id = $2 AND deleted_at IS NOT NULL;
```

### An append-only record

A note never changes after it is written, so it has only `created_at` and `created_by_id`, and the database
refuses updates and deletes:

```sql
CREATE TABLE project_notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT
);
CREATE INDEX project_notes_project_id ON project_notes (project_id, created_at);
CREATE INDEX project_notes_created_by_id ON project_notes (created_by_id);

CREATE FUNCTION refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_notes_append_only BEFORE UPDATE OR DELETE ON project_notes
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
```

### A revision table

Each change of a project writes one revision in the same transaction as the update. The revision is
append-only too:

```sql
CREATE TABLE project_revisions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  changes jsonb NOT NULL,  -- {"display_name": {"old": "...", "new": "..."}}
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  UNIQUE (project_id, revision)
);
CREATE INDEX project_revisions_created_by_id ON project_revisions (created_by_id);

CREATE TRIGGER project_revisions_append_only BEFORE UPDATE OR DELETE ON project_revisions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
```

### A join row and a reference to one of several tables

A membership that only links a user and a project has the composite key. A comment belongs to a project or to
a note, never both, so it has one foreign key per target and a check, not `subject_type` and `subject_id`:

```sql
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_id ON project_members (user_id);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id uuid REFERENCES projects (id) ON DELETE RESTRICT,
  project_note_id uuid REFERENCES project_notes (id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  deleted_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(project_id, project_note_id) = 1)
);
CREATE INDEX comments_project_id ON comments (project_id);
CREATE INDEX comments_project_note_id ON comments (project_note_id);
```

## SQLite

SQLite has no UUID or timestamp type. Store the UUID as its 36-character text and the timestamp as ISO 8601
text in UTC with milliseconds. `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` gives that form. Turn on foreign keys
on every connection, and use `STRICT` tables so that SQLite refuses values of the wrong type.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  slug TEXT NOT NULL CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  type TEXT NOT NULL CHECK (type IN ('internal', 'client')),
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  deleted_at TEXT,
  deleted_by_id TEXT REFERENCES users (id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE UNIQUE INDEX projects_slug_live ON projects (slug) WHERE deleted_at IS NULL;
CREATE INDEX projects_owner_id ON projects (owner_id);

CREATE TRIGGER projects_touch AFTER UPDATE ON projects
FOR EACH ROW WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE projects
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = OLD.revision + 1
  WHERE id = NEW.id;
END;

CREATE TRIGGER project_notes_no_update BEFORE UPDATE ON project_notes
BEGIN
  SELECT RAISE(ABORT, 'project_notes is append-only');
END;
CREATE TRIGGER project_notes_no_delete BEFORE DELETE ON project_notes
BEGIN
  SELECT RAISE(ABORT, 'project_notes is append-only');
END;
```

The `WHEN` clause stops the touch trigger from firing on its own update.

## A stored JSON document

```json
{
  "schema_version": 1,
  "id": "01933b6e-8f2a-7c4e-9b1d-3f6a2c8e5d41",
  "number": 1042,
  "slug": "elm-street-renovation",
  "display_name": "Elm Street renovation",
  "type": "client",
  "status": "active",
  "owner_id": "01933b6a-1c07-7d2e-a4f0-5b8e9c1d2a36",
  "budget_minor_units": 1250000,
  "budget_currency": "EUR",
  "starts_on": "2026-02-01",
  "tags": ["kitchen", "permit"],
  "created_at": "2026-01-15T09:30:00.000Z",
  "created_by_id": "01933b6a-1c07-7d2e-a4f0-5b8e9c1d2a36",
  "updated_at": "2026-01-20T14:05:12.481Z",
  "updated_by_id": "01933b6a-1c07-7d2e-a4f0-5b8e9c1d2a36",
  "archived_at": null,
  "deleted_at": null,
  "deleted_by_id": null,
  "revision": 3
}
```

## API payloads

A list is an object with the items and the cursor of the next page; `next_cursor` is null on the last page:

```json
{
  "items": [
    {
      "id": "01933b6e-8f2a-7c4e-9b1d-3f6a2c8e5d41",
      "display_name": "Elm Street renovation",
      "status": "active",
      "updated_at": "2026-01-20T14:05:12.481Z",
      "revision": 3
    }
  ],
  "next_cursor": "MjAyNi0wMS0yMFQxNDowNToxMi40ODFafDAxOTMzYjZl"
}
```

A partial update sends only the changed fields and the revision that the client read:

```json
{
  "display_name": "Elm Street kitchen renovation",
  "revision": 3
}
```

When the stored revision differs, the answer is HTTP 409 with a stable code:

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "The project changed since you read it. Load it again and repeat your change."
  }
}
```

## From a name key to a UUID key

A table `teams` uses its `name` as the primary key, and `memberships.team` references it. This migration
gives `teams` a UUID key, moves the reference to `team_id`, and turns the old name into a `slug` and a
`display_name`. It runs in one transaction in PostgreSQL 18 or later. A volatile default such as `uuidv7()`
is evaluated once for each existing row, so every team gets its own id.

```sql
BEGIN;

ALTER TABLE teams ADD COLUMN id uuid NOT NULL DEFAULT uuidv7();

ALTER TABLE memberships ADD COLUMN team_id uuid;
UPDATE memberships AS m SET team_id = t.id FROM teams AS t WHERE m.team = t.name;
ALTER TABLE memberships ALTER COLUMN team_id SET NOT NULL;

ALTER TABLE memberships DROP CONSTRAINT memberships_team_fkey;
ALTER TABLE teams DROP CONSTRAINT teams_pkey;
ALTER TABLE teams ADD PRIMARY KEY (id);
ALTER TABLE memberships
  ADD CONSTRAINT memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE RESTRICT;
CREATE INDEX memberships_team_id ON memberships (team_id);
ALTER TABLE memberships DROP COLUMN team;

ALTER TABLE teams RENAME COLUMN name TO slug;
CREATE UNIQUE INDEX teams_slug_live ON teams (slug) WHERE deleted_at IS NULL;
ALTER TABLE teams ADD COLUMN display_name text;
UPDATE teams SET display_name = slug;
ALTER TABLE teams ALTER COLUMN display_name SET NOT NULL;

COMMIT;
```

Then, in the same release:

- Check the counts before you commit: every membership has a `team_id`, and the number of teams is the same.
- Move every storage path, cache key and queue message from `teams/<name>/` to `teams/<id>/`.
- Change the code and the API to look teams up by `id`, and by `slug` only where a person types it.
- Do not keep the old name as an alias. A request with an old name gets a clear "not found" error.
