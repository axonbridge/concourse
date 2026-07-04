-- Per-project toggle for the version-control UI (Ship, branch status, diff/review).
-- Defaults on for all existing projects; turned off for non-code "business"
-- workspaces. Runtime code also applies this via ensureColumn() in
-- src/db/client.ts for schema-divergent builds.
ALTER TABLE projects ADD COLUMN git_enabled INTEGER NOT NULL DEFAULT 1;
