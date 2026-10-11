import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import * as schema from "./schema";

// Node-only DB initialization. NEVER imported on Cloudflare — the runtime
// proxy in `./index.ts` uses an eval-based require to keep this file (and
// its native better-sqlite3 binding) out of the Workers bundle.
//
// Initialization is lazy: the first call creates the schema, runs ALTERs for
// added columns, and seeds default rows. Subsequent calls return the cached
// drizzle instance.

let cached: BetterSQLite3Database<typeof schema> | null = null;

export function initNodeDb(): BetterSQLite3Database<typeof schema> {
  if (cached) return cached;

  const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "app.db");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#d94a1f',
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#7a766a',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      color TEXT NOT NULL DEFAULT '#5e6ad2',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3f8fb0',
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#b86a3f',
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      enc_password TEXT,
      enc_email TEXT,
      enc_2fa TEXT,
      enc_email_password TEXT,
      note TEXT,
      avatar_url TEXT,
      follower_count INTEGER,
      following_count INTEGER,
      video_count INTEGER,
      last_videos TEXT,
      last_synced_at INTEGER,
      last_sync_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

    CREATE TABLE IF NOT EXISTS facebook_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      status_id INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
      country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL,
      machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
      employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      enc_password TEXT,
      enc_email TEXT,
      enc_2fa TEXT,
      enc_email_password TEXT,
      enc_access_token TEXT,
      token_expires_at INTEGER,
      password_history TEXT,
      email_password_history TEXT,
      fb_user_id TEXT,
      fb_name TEXT,
      fb_profile_pic TEXT,
      note TEXT,
      last_synced_at INTEGER,
      last_sync_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_username ON facebook_accounts(username);
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_group_id ON facebook_accounts(group_id);
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_status_id ON facebook_accounts(status_id);
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_country_id ON facebook_accounts(country_id);
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_machine_id ON facebook_accounts(machine_id);
    CREATE INDEX IF NOT EXISTS idx_fb_accounts_employee_id ON facebook_accounts(employee_id);

    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);

    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
  `);

  function ensureColumn(table: string, column: string, ddl: string) {
    const cols = sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  // Fanpage management was removed (mirrors D1 migration 0004). Children
  // first so FK checks pass. The Insight screen reads pages live from Graph.
  sqlite.exec(`
    DROP TABLE IF EXISTS fanpage_snapshots;
    DROP TABLE IF EXISTS fanpage_posts;
    DROP TABLE IF EXISTS fanpages;
    DROP TABLE IF EXISTS insight_groups;
  `);

  // Insight tokens + page groups (mirrors D1 migration 0005).
  sqlite.exec(`
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
  `);

  // Multi-tenant ownership column added in migration 0002. Local dev DBs
  // bootstrapped before this migration must be ALTERed to match. NULL ok
  // until backfill — assigns to admin user 1 below.
  for (const tbl of [
    "groups",
    "statuses",
    "countries",
    "machines",
    "employees",
    "accounts",
    "facebook_accounts",
  ]) {
    ensureColumn(
      tbl,
      "owner_user_id",
      "owner_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE",
    );
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${tbl}_owner ON ${tbl}(owner_user_id);`);
  }
  // Backfill: any pre-existing rows are assigned to the first admin user. New
  // installs have no rows yet, so this is a no-op for them.
  const firstAdmin = sqlite
    .prepare(
      `SELECT id FROM app_users WHERE role='admin' ORDER BY id LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (firstAdmin) {
    for (const tbl of [
      "groups",
      "statuses",
      "countries",
      "machines",
      "employees",
      "accounts",
      "facebook_accounts",
    ]) {
      sqlite
        .prepare(`UPDATE ${tbl} SET owner_user_id = ? WHERE owner_user_id IS NULL`)
        .run(firstAdmin.id);
    }
  }
  ensureColumn("accounts", "group_id", "group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL");
  ensureColumn("accounts", "status_id", "status_id INTEGER REFERENCES statuses(id) ON DELETE SET NULL");
  ensureColumn("accounts", "country_id", "country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL");
  ensureColumn("accounts", "machine_id", "machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL");
  ensureColumn("accounts", "employee_id", "employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL");
  ensureColumn("accounts", "password_history", "password_history TEXT");
  ensureColumn("accounts", "email_password_history", "email_password_history TEXT");
  ensureColumn("accounts", "enc_ms_refresh_token", "enc_ms_refresh_token TEXT");
  ensureColumn("accounts", "enc_ms_access_token", "enc_ms_access_token TEXT");
  ensureColumn("accounts", "ms_token_expires_at", "ms_token_expires_at INTEGER");
  ensureColumn("accounts", "ms_email", "ms_email TEXT");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_group_id ON accounts(group_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_status_id ON accounts(status_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_country_id ON accounts(country_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_machine_id ON accounts(machine_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_employee_id ON accounts(employee_id);`);

  // Usernames are unique per user, not globally (mirrors D1 migration 0006).
  // Old local DBs declared `username TEXT NOT NULL UNIQUE` inline, which
  // SQLite can't drop — rebuild the table once without it, keeping every
  // column (the stored CREATE sql already includes ALTER-added columns) and
  // every index.
  const accountsSql = (
    sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'`).get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (accountsSql && /username\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(accountsSql)) {
    const indexSql = (
      sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='accounts' AND sql IS NOT NULL`)
        .all() as Array<{ sql: string }>
    ).map((r) => r.sql);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.transaction(() => {
      sqlite.exec(
        accountsSql
          .replace(/username\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i, "username TEXT NOT NULL")
          .replace(/CREATE TABLE\s+("?accounts"?|`accounts`)/i, "CREATE TABLE accounts__rebuild"),
      );
      sqlite.exec(`INSERT INTO accounts__rebuild SELECT * FROM accounts`);
      sqlite.exec(`DROP TABLE accounts`);
      sqlite.exec(`ALTER TABLE accounts__rebuild RENAME TO accounts`);
      for (const s of indexSql) sqlite.exec(s);
    })();
    sqlite.pragma("foreign_keys = ON");
  }
  sqlite.exec(`DROP INDEX IF EXISTS accounts_username_unique;`);
  sqlite.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_username_unique ON accounts(owner_user_id, username);`,
  );

  // Seed default statuses on first boot (only if empty)
  const statusCount = sqlite
    .prepare(`SELECT COUNT(*) as c FROM statuses`)
    .get() as { c: number };
  if (statusCount.c === 0) {
    const insert = sqlite.prepare(
      `INSERT INTO statuses (name, color, sort_order) VALUES (?, ?, ?)`,
    );
    insert.run("BKT", "#2d5a3d", 10);
    insert.run("TKT", "#2f6bb0", 20);
    insert.run("ĐANG BUILD", "#b88c3a", 30);
  }

  const countryCount = sqlite
    .prepare(`SELECT COUNT(*) as c FROM countries`)
    .get() as { c: number };
  if (countryCount.c === 0) {
    const insert = sqlite.prepare(
      `INSERT INTO countries (name, code, color, sort_order) VALUES (?, ?, ?, ?)`,
    );
    insert.run("Việt Nam", "VN", "#d94a1f", 10);
    insert.run("Hoa Kỳ", "US", "#2f6bb0", 20);
    insert.run("Anh", "UK", "#7a4e9c", 30);
    insert.run("Châu Âu", "EU", "#2d5a3d", 40);
    insert.run("Nhật", "JP", "#c23e6f", 50);
    insert.run("Hàn Quốc", "KR", "#b88c3a", 60);
    insert.run("Khác", "OT", "#7a766a", 90);
  }

  const machineCount = sqlite
    .prepare(`SELECT COUNT(*) as c FROM machines`)
    .get() as { c: number };
  if (machineCount.c === 0) {
    const insert = sqlite.prepare(
      `INSERT INTO machines (name, color, sort_order) VALUES (?, ?, ?)`,
    );
    insert.run("Máy 01", "#3f8fb0", 10);
    insert.run("Máy 02", "#7a4e9c", 20);
    insert.run("Máy 03", "#2d5a3d", 30);
  }

  const employeeCount = sqlite
    .prepare(`SELECT COUNT(*) as c FROM employees`)
    .get() as { c: number };
  if (employeeCount.c === 0) {
    const insert = sqlite.prepare(
      `INSERT INTO employees (name, color, sort_order) VALUES (?, ?, ?)`,
    );
    insert.run("Chưa gán", "#7a766a", 0);
  }

  // Bootstrap default admin user. Reads INITIAL_ADMIN_USERNAME +
  // INITIAL_ADMIN_PASSWORD from env; falls back to admin/admin and warns.
  // Runs only once — when app_users is empty.
  const userCount = sqlite
    .prepare(`SELECT COUNT(*) as c FROM app_users`)
    .get() as { c: number };
  if (userCount.c === 0) {
    const username = process.env.INITIAL_ADMIN_USERNAME || "admin";
    const password = process.env.INITIAL_ADMIN_PASSWORD || "admin";
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    const passwordHash = `${salt.toString("base64")}$${hash.toString("base64")}`;
    sqlite
      .prepare(
        `INSERT INTO app_users (username, password_hash, role) VALUES (?, ?, 'admin')`,
      )
      .run(username, passwordHash);
    if (!process.env.INITIAL_ADMIN_PASSWORD) {
      console.warn(
        `[social-manager] Bootstrap admin created: ${username}/${password}. ` +
          `Set INITIAL_ADMIN_PASSWORD env to override and change the password ` +
          `via /admin/users immediately.`,
      );
    } else {
      console.info(
        `[social-manager] Bootstrap admin '${username}' created from env.`,
      );
    }
  }

  cached = drizzle(sqlite, { schema });
  return cached;
}
