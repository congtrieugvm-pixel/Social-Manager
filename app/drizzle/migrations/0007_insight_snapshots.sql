-- Last fetched Insight data per owner, so reloading the Insight page shows it
-- instantly instead of re-reading every page from Graph (refreshed on the
-- "Load Insight" button or when older than 2 hours).
--   kind 'reach' / 'monet' : key = page id
--   kind 'pages'           : key = "t:<tokenId>" (that token's page list)
-- Additive only, idempotent.

CREATE TABLE IF NOT EXISTS insight_snapshots (
  owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, kind, key)
);
