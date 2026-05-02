// Export user-data INSERT statements from local SQLite (data/app.db) into a
// .sql file that can be replayed against Cloudflare D1 via:
//   wrangler d1 execute social-manager --remote --file=...
//
// Skips: sqlite_*, d1_migrations (D1 internal), app_sessions (ephemeral),
// and the rows we've already seeded in CF (statuses, countries, machines,
// employees) — D1 already has them, double-insert would conflict.
//
// Output: scripts/_data-export.sql (gitignored).

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve("data/app.db");
const OUT = path.resolve("scripts/_data-export.sql");

const db = new Database(SRC, { readonly: true });

// Tables to export. Order matters — children after parents (FK). Include
// the dimension tables (statuses/countries/...) too in case local has more
// rows than the D1 seed; INSERT OR IGNORE handles duplicates.
const TABLES = [
  "groups",
  "statuses",
  "countries",
  "machines",
  "employees",
  "insight_groups",
  "app_users",
  "facebook_accounts",
  "fanpages",
  "fanpage_posts",
  "fanpage_snapshots",
  "accounts", // tiktok accounts
];

// Per-table columns to skip — `insights_json` caches FB API responses and
// can be 50–200KB each, exceeding D1's per-statement byte limit. The data
// is regeneratable from FB by clicking "Sync" in the UI.
const SKIP_COLS = {
  fanpages: ["insights_json", "earnings_breakdown_json"],
  fanpage_posts: ["insights_json"],
  accounts: ["last_videos"],
};

const lines = [];

for (const table of TABLES) {
  const skip = new Set(SKIP_COLS[table] ?? []);
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)
    .filter((c) => !skip.has(c));
  if (cols.length === 0) {
    console.warn(`[export] table not found: ${table}, skipping`);
    continue;
  }
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) {
    console.log(`[export] ${table}: 0 rows`);
    continue;
  }
  for (const r of rows) {
    const values = cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      if (typeof v === "bigint") return String(v);
      if (Buffer.isBuffer(v)) return "X'" + v.toString("hex") + "'";
      // string — escape single quotes
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    const colList = cols.map((c) => `"${c}"`).join(",");
    lines.push(
      `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${values.join(",")});`,
    );
  }
  console.log(`[export] ${table}: ${rows.length} rows`);
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`[export] wrote ${lines.length} INSERT statements → ${OUT}`);
console.log(`[export] file size: ${fs.statSync(OUT).size} bytes`);

db.close();
