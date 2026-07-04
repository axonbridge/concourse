-- Session mode: "terminal" (classic xterm) or "chat" (the no-terminal chat
-- surface rendered by ChatView via the Claude Agent SDK). NULL/absent defaults
-- to "terminal" so older rows keep rendering as terminal sessions.
ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal';
