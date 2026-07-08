-- System tasks (background jobs): hidden from all session lists.
ALTER TABLE tasks ADD COLUMN system INTEGER NOT NULL DEFAULT 0;
-- Backfill: curation runs created before this flag existed become system
-- tasks retroactively, so they disappear from Archived on first launch.
UPDATE tasks SET system = 1 WHERE title LIKE 'Knowledge curation%';
