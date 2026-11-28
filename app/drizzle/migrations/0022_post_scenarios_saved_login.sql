-- When this browser profile last signed in to TikTok (NULL = no saved login): drives the green
-- browser icon on the accounts tab ("opening it won't need a login").
ALTER TABLE browser_profiles ADD COLUMN logged_in_at INTEGER;

-- Saved posting scenarios ("kịch bản đăng"): one shared folder whose videos are split across the
-- selected accounts (each video posted once), caption, posts per account, timing, delete-after.
CREATE TABLE IF NOT EXISTS post_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  folder TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  per_account INTEGER NOT NULL DEFAULT 1,
  time_mode TEXT NOT NULL DEFAULT 'now', -- now | time (fixed time of day) | window (random inside a daily window)
  at_min INTEGER,                        -- time: minute of the day
  start_min INTEGER,                     -- window: first minute of the day
  end_min INTEGER,                       -- window: last minute of the day
  delete_after INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS post_scenarios_owner ON post_scenarios(owner_user_id);
