// Shared with migration 0015; local bootstrap calls after legacy table rebuilds.
export const BROWSER_DDL = `
CREATE TABLE IF NOT EXISTS browser_posting (account_id INTEGER PRIMARY KEY, owner_user_id INTEGER NOT NULL, device_id TEXT NOT NULL, folder TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS browser_login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS browser_proxies (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER NOT NULL, name TEXT NOT NULL, server TEXT NOT NULL, enc_username TEXT, enc_password TEXT, enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS browser_devices (id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, version TEXT NOT NULL, run_id TEXT, last_seen_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS browser_device_token ON browser_devices(token_hash);
CREATE TABLE IF NOT EXISTS browser_pairings (hash TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS browser_profiles (account_id INTEGER PRIMARY KEY, owner_user_id INTEGER NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL, job_id TEXT, status TEXT NOT NULL DEFAULT 'closed', updated_at INTEGER NOT NULL, proxy_label TEXT NOT NULL DEFAULT 'Trực tiếp', config_key TEXT);
CREATE TABLE IF NOT EXISTS browser_jobs (id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, device_id TEXT NOT NULL, kind TEXT NOT NULL, account_id INTEGER, proxy_id INTEGER, config_key TEXT, autofill INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'queued', error TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS browser_jobs_device_queue ON browser_jobs(device_id, state, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS browser_jobs_active_account ON browser_jobs(account_id) WHERE kind='open' AND state IN ('queued','claimed','running');
CREATE UNIQUE INDEX IF NOT EXISTS browser_jobs_active_post ON browser_jobs(account_id) WHERE kind='post' AND state IN ('queued','claimed','running');
CREATE TABLE IF NOT EXISTS browser_proxy_checks (job_id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, proxy_id INTEGER NOT NULL, device_id TEXT NOT NULL, revision INTEGER NOT NULL, ip TEXT, latency INTEGER, error TEXT, checked_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS browser_account_delete AFTER DELETE ON accounts BEGIN
 UPDATE browser_jobs SET state='cancelled' WHERE account_id=OLD.id AND state IN ('queued','claimed','running');
 UPDATE browser_profiles SET status='revoked', job_id=NULL WHERE account_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS browser_account_transfer AFTER UPDATE OF owner_user_id ON accounts WHEN NEW.owner_user_id IS NOT OLD.owner_user_id BEGIN
 UPDATE accounts SET browser_proxy_id=NULL, browser_proxy_mode='inherit' WHERE id=NEW.id;
 UPDATE browser_jobs SET state='cancelled' WHERE account_id=OLD.id AND state IN ('queued','claimed','running');
 UPDATE browser_profiles SET status='revoked', job_id=NULL WHERE account_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS browser_proxy_delete BEFORE DELETE ON browser_proxies WHEN EXISTS(SELECT 1 FROM accounts WHERE browser_proxy_id=OLD.id) OR EXISTS(SELECT 1 FROM groups WHERE browser_proxy_id=OLD.id) BEGIN
 SELECT RAISE(ABORT, 'PROXY_IN_USE');
END;
`;
