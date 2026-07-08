-- Private projects: sessions never see (or write to) org knowledge —
-- personal work stays strictly local to the project.
ALTER TABLE projects ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
