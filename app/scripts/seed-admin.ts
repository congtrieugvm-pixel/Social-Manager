/**
 * One-shot script to upsert an admin user into the local SQLite DB.
 *
 * Usage: npx tsx scripts/seed-admin.ts <username> <password>
 *        npx tsx scripts/seed-admin.ts Trieugvm trieudz
 *
 * Idempotent: if the username already exists, this rewrites the password
 * hash and forces role=admin + is_active=1. Otherwise it inserts a new row.
 */
import Database from "better-sqlite3";
import path from "node:path";
import crypto from "node:crypto";

const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
  console.error("Usage: npx tsx scripts/seed-admin.ts <username> <password>");
  process.exit(1);
}

const dbPath =
  process.env.DB_PATH || path.join(process.cwd(), "data", "app.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Ensure the table exists in case this is a fresh checkout that hasn't been
// booted via Next yet — mirrors lib/db/index.ts DDL.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Match lib/auth.ts hashing exactly: scrypt, 16-byte salt, 64-byte key,
// stored as `saltBase64$hashBase64`.
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
const passwordHash = `${salt.toString("base64")}$${hash.toString("base64")}`;

const existing = db
  .prepare("SELECT id, role, is_active FROM app_users WHERE username = ?")
  .get(username) as
  | { id: number; role: string; is_active: number }
  | undefined;

if (existing) {
  db.prepare(
    `UPDATE app_users
     SET password_hash = ?,
         role = 'admin',
         is_active = 1,
         updated_at = unixepoch()
     WHERE id = ?`,
  ).run(passwordHash, existing.id);
  // Invalidate any old sessions so the new password takes effect immediately.
  db.exec("CREATE TABLE IF NOT EXISTS app_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER NOT NULL)");
  db.prepare("DELETE FROM app_sessions WHERE user_id = ?").run(existing.id);
  console.log(
    `[seed-admin] Updated user @${username} (id=${existing.id}) → role=admin, is_active=1, password reset, sessions cleared.`,
  );
} else {
  const result = db
    .prepare(
      `INSERT INTO app_users (username, password_hash, role, is_active)
       VALUES (?, ?, 'admin', 1)`,
    )
    .run(username, passwordHash);
  console.log(
    `[seed-admin] Created admin @${username} (id=${result.lastInsertRowid}).`,
  );
}

db.close();
