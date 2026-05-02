-- Multi-tenant: every "data" table now has an owner_user_id FK to app_users.
-- Existing rows back-fill to the first admin (Trieugvm in current D1).
-- New user registrations get empty workspaces; their inserts set
-- owner_user_id = current session user.

ALTER TABLE accounts          ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE facebook_accounts ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE fanpages          ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE groups            ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE statuses          ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE countries         ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE machines          ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE employees         ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE insight_groups    ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE;

-- Back-fill all pre-existing rows to the first admin in the system. Future
-- inserts go through code that sets owner_user_id = current user.
UPDATE accounts          SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE facebook_accounts SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE fanpages          SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE groups            SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE statuses          SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE countries         SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE machines          SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE employees         SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;
UPDATE insight_groups    SET owner_user_id = (SELECT id FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_user_id IS NULL;

-- Owner-scoped indexes for fast per-user reads.
CREATE INDEX IF NOT EXISTS idx_accounts_owner          ON accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_facebook_accounts_owner ON facebook_accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_fanpages_owner          ON fanpages(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_groups_owner            ON groups(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_owner          ON statuses(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_countries_owner         ON countries(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_machines_owner          ON machines(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_employees_owner         ON employees(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_insight_groups_owner    ON insight_groups(owner_user_id);
