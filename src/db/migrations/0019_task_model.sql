-- Chat sessions: persist the model chosen in the picker so reopening a
-- session after an app restart keeps the same model (and it can be changed,
-- which reconnects the conversation).
ALTER TABLE tasks ADD COLUMN model TEXT;
