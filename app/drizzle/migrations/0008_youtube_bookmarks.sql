-- Bookmark Key: YouTube channel bookmarks (per owner) with "new video"
-- badges, grouped with notes. Videos come from the public channel RSS feed
-- (no API key). Additive only, idempotent.

CREATE TABLE IF NOT EXISTS yt_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5e6ad2',
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS yt_groups_owner_name ON yt_groups(owner_user_id, name);

CREATE TABLE IF NOT EXISTS yt_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  avatar TEXT,
  group_id INTEGER REFERENCES yt_groups(id) ON DELETE SET NULL,
  note TEXT,
  videos TEXT,
  last_seen_at INTEGER NOT NULL,
  checked_at INTEGER,
  check_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS yt_channels_owner_channel ON yt_channels(owner_user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_yt_channels_group ON yt_channels(group_id);
