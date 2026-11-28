import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const browserLoginAttempts = sqliteTable('browser_login_attempts', {
  key: text('key').primaryKey(), attempts: integer('attempts').notNull().default(0), expiresAt: integer('expires_at').notNull(),
});

export const browserProxies = sqliteTable("browser_proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }), ownerUserId: integer("owner_user_id").notNull(),
  name: text("name").notNull(), server: text("server").notNull(), encUsername: text("enc_username"), encPassword: text("enc_password"),
  enabled: integer("enabled").notNull().default(1), revision: integer("revision").notNull().default(1),
});
export const browserDevices = sqliteTable("browser_devices", {
  id: text("id").primaryKey(), ownerUserId: integer("owner_user_id").notNull(), name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(), version: text("version").notNull(), runId: text("run_id"),
  lastSeenAt: integer("last_seen_at").notNull(), revoked: integer("revoked").notNull().default(0),
  maxWindows: integer("max_windows").notNull().default(3),
});
export const browserPairings = sqliteTable("browser_pairings", {
  hash: text("hash").primaryKey(), ownerUserId: integer("owner_user_id").notNull(), expiresAt: integer("expires_at").notNull(), usedAt: integer("used_at"),
});
export const browserProfiles = sqliteTable("browser_profiles", {
  accountId: integer("account_id").primaryKey(), ownerUserId: integer("owner_user_id").notNull(),
  id: text("id").notNull(), deviceId: text("device_id").notNull(), jobId: text("job_id"),
  status: text("status").notNull().default("closed"), updatedAt: integer("updated_at").notNull(),
  proxyLabel: text("proxy_label").notNull().default("Trực tiếp"), configKey: text("config_key"),
  /** When this profile last signed in to TikTok; null = no saved login. */
  loggedInAt: integer("logged_in_at"),
});
export const postScenarios = sqliteTable("post_scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }), ownerUserId: integer("owner_user_id").notNull(),
  name: text("name").notNull(), folder: text("folder").notNull(), caption: text("caption").notNull().default(""),
  perAccount: integer("per_account").notNull().default(1),
  timeMode: text("time_mode").notNull().default("now"), atMin: integer("at_min"), startMin: integer("start_min"), endMin: integer("end_min"),
  deleteAfter: integer("delete_after").notNull().default(0), updatedAt: integer("updated_at").notNull(),
});
export const browserJobs = sqliteTable("browser_jobs", {
  result: text('result'),
  payload: text('payload'),
  id: text("id").primaryKey(), ownerUserId: integer("owner_user_id").notNull(), deviceId: text("device_id").notNull(),
  kind: text("kind").notNull(), accountId: integer("account_id"), proxyId: integer("proxy_id"),
  configKey: text("config_key"), autofill: integer("autofill").notNull().default(1),
  state: text("state").notNull().default("queued"), error: text("error"),
  createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
});
export const browserPosting = sqliteTable('browser_posting', {
  accountId: integer('account_id').primaryKey(), ownerUserId: integer('owner_user_id').notNull(),
  deviceId: text('device_id').notNull(), folder: text('folder').notNull(), caption: text('caption').notNull().default(''),
});
export const browserProxyChecks = sqliteTable("browser_proxy_checks", {
  jobId: text("job_id").primaryKey(), ownerUserId: integer("owner_user_id").notNull(), proxyId: integer("proxy_id").notNull(),
  deviceId: text("device_id").notNull(), revision: integer("revision").notNull(), ip: text("ip"),
  latency: integer("latency"), error: text("error"), checkedAt: integer("checked_at").notNull(),
});
