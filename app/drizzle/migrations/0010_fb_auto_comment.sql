-- Insight "Comment tự động": comment as the Page on every new post of the
-- chosen Pages / Page groups, picking one of several prepared texts.
-- Additive only.

CREATE TABLE IF NOT EXISTS fb_comment_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- 'page' (target_id = Facebook page id) | 'group' (target_id = insight_page_groups.id)
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- JSON array of comment texts; one is picked at random per post
  comments TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- unix s: only posts created after this get a comment (reset when re-enabled)
  active_since INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_fb_comment_rules_owner ON fb_comment_rules(owner_user_id);

-- One row per post handled (ok or a non-retryable error) — never twice.
CREATE TABLE IF NOT EXISTS fb_comment_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  rule_id INTEGER REFERENCES fb_comment_rules(id) ON DELETE SET NULL,
  page_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  post_message TEXT,
  comment TEXT,
  comment_id TEXT,
  status TEXT NOT NULL, -- 'ok' | 'error'
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_comment_log_owner_post ON fb_comment_log(owner_user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_fb_comment_log_owner_time ON fb_comment_log(owner_user_id, created_at);
