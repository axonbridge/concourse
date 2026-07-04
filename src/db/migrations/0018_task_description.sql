-- User-set description shown as a session card's subtitle (falls back to the live
-- `preview` when empty). Runtime code also applies this via ensureColumn() in
-- src/db/client.ts for schema-divergent builds.
ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';
