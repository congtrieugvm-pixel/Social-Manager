CREATE TABLE IF NOT EXISTS browser_posting (account_id INTEGER PRIMARY KEY, owner_user_id INTEGER NOT NULL, device_id TEXT NOT NULL, folder TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '');
ALTER TABLE browser_jobs ADD COLUMN payload TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS browser_jobs_active_post ON browser_jobs(account_id) WHERE kind='post' AND state IN ('queued','claimed','running');
