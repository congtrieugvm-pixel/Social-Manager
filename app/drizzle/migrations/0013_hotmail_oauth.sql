ALTER TABLE accounts ADD COLUMN ms_client_id TEXT;
ALTER TABLE accounts ADD COLUMN ms_token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN ms_oauth_nonce TEXT;
