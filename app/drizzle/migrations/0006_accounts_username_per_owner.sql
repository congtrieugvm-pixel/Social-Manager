-- TikTok account usernames are unique PER USER, not across the whole system.
-- Before: global UNIQUE(username) — importing an account another user already
-- had failed with "Username đã thuộc tài khoản người dùng khác". Each user
-- manages their own copy now (also needed to transfer/copy accounts between
-- users). No data changes; idempotent.

DROP INDEX IF EXISTS accounts_username_unique;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_username_unique
  ON accounts (owner_user_id, username);
