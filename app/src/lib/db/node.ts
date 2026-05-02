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
      username TEXT NOT NULL UNIQUE,
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

    CREATE TABLE IF NOT EXISTS fanpages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fb_account_id INTEGER NOT NULL REFERENCES facebook_accounts(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      category_list TEXT,
      about TEXT,
      description TEXT,
      picture_url TEXT,
      cover_url TEXT,
      link TEXT,
      username TEXT,
      fan_count INTEGER,
      followers_count INTEGER,
      new_like_count INTEGER,
      rating_count INTEGER,
      overall_star_rating TEXT,
      verification_status TEXT,
      tasks TEXT,
      enc_page_access_token TEXT,
      insights_json TEXT,
      last_synced_at INTEGER,
      last_sync_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fanpages_account_page ON fanpages(fb_account_id, page_id);
    CREATE INDEX IF NOT EXISTS idx_fanpages_page_id ON fanpages(page_id);

    CREATE TABLE IF NOT EXISTS fanpage_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fanpage_id INTEGER NOT NULL REFERENCES fanpages(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL,
      message TEXT,
      story TEXT,
      permalink_url TEXT,
      full_picture_url TEXT,
      status_type TEXT,
      created_time INTEGER,
      reactions_total INTEGER,
      comments_total INTEGER,
      shares_total INTEGER,
      impressions INTEGER,
      impressions_unique INTEGER,
      reach INTEGER,
      engaged_users INTEGER,
      clicks INTEGER,
      video_views INTEGER,
      insights_json TEXT,
      last_insights_at INTEGER,
      last_insights_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fanpage_posts_fp_post ON fanpage_posts(fanpage_id, post_id);
    CREATE INDEX IF NOT EXISTS idx_fanpage_posts_created ON fanpage_posts(created_time DESC);

    CREATE TABLE IF NOT EXISTS insight_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#5e6ad2',
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

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

    CREATE TABLE IF NOT EXISTS fanpage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fanpage_id INTEGER NOT NULL REFERENCES fanpages(id) ON DELETE CASCADE,
      taken_at INTEGER NOT NULL DEFAULT (unixepoch()),
      fan_count INTEGER,
      followers_count INTEGER,
      page_impressions INTEGER,
      page_impressions_unique INTEGER,
      page_engagements INTEGER,
      page_views INTEGER,
      page_video_views INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_fanpage_snapshots_fp_time ON fanpage_snapshots(fanpage_id, taken_at DESC);
  `);

  function ensureColumn(table: string, column: string, ddl: string) {
    const cols = sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  ensureColumn(
    "fanpages",
    "insight_group_id",
    "insight_group_id INTEGER REFERENCES insight_groups(id) ON DELETE SET NULL",
  );
  ensureColumn("fanpage_snapshots", "range_start", "range_start INTEGER");
  ensureColumn("fanpage_snapshots", "range_end", "range_end INTEGER");
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_fanpages_insight_group ON fanpages(insight_group_id);`,
  );

  // Monetization tracking (page-level + post-level).
  ensureColumn("fanpages", "monetization_status", "monetization_status TEXT");
  ensureColumn("fanpages", "monetization_error", "monetization_error TEXT");
  ensureColumn("fanpages", "earnings_value", "earnings_value INTEGER");
  ensureColumn("fanpages", "earnings_currency", "earnings_currency TEXT");
  ensureColumn("fanpages", "earnings_range_start", "earnings_range_start INTEGER");
  ensureColumn("fanpages", "earnings_range_end", "earnings_range_end INTEGER");
  ensureColumn("fanpages", "earnings_updated_at", "earnings_updated_at INTEGER");
  ensureColumn("fanpages", "earnings_breakdown_json", "earnings_breakdown_json TEXT");
  ensureColumn("fanpage_posts", "ad_break_earnings", "ad_break_earnings INTEGER");
  ensureColumn("fanpage_posts", "ad_break_currency", "ad_break_currency TEXT");
  ensureColumn("fanpage_posts", "earnings_updated_at", "earnings_updated_at INTEGER");
  ensureColumn("fanpage_posts", "earnings_error", "earnings_error TEXT");

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
