-- Insight (Page Reach), independent of facebook_accounts:
--   insight_tokens            — pasted User / Page access tokens (encrypted)
--   insight_page_groups       — the owner's page groups
--   insight_page_assignments  — page_id → group (one group per page)
-- Pages are not stored; they are listed live from Graph with the tokens.
-- Additive only, idempotent.

CREATE TABLE IF NOT EXISTS insight_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'user',
  enc_token TEXT NOT NULL,
  fb_id TEXT,
  fb_name TEXT,
  token_preview TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_insight_tokens_owner ON insight_tokens(owner_user_id);

CREATE TABLE IF NOT EXISTS insight_page_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5e6ad2',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS insight_page_groups_owner_name
  ON insight_page_groups(owner_user_id, name);

CREATE TABLE IF NOT EXISTS insight_page_assignments (
  owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  group_id INTEGER NOT NULL REFERENCES insight_page_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_user_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_insight_page_assignments_group
  ON insight_page_assignments(group_id);
