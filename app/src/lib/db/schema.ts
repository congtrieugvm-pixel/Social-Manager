import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Multi-tenant: every data row is scoped to an owning app_user. New users
// register → empty workspace; their inserts auto-set owner_user_id from
// the active session. Old rows backfilled to first admin in migration 0002.
export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#d94a1f"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const statuses = sqliteTable("statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#7a766a"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const countries = sqliteTable("countries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  code: text("code"),
  color: text("color").notNull().default("#5e6ad2"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const machines = sqliteTable("machines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3f8fb0"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#b86a3f"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  username: text("username").notNull(),

  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  statusId: integer("status_id").references(() => statuses.id, { onDelete: "set null" }),
  countryId: integer("country_id").references(() => countries.id, { onDelete: "set null" }),
  machineId: integer("machine_id").references(() => machines.id, { onDelete: "set null" }),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),

  // Encrypted fields (AES-256-GCM). Format: `${ivBase64}:${ciphertextBase64}` (auth tag appended to ciphertext).
  encPassword: text("enc_password"),
  encEmail: text("enc_email"),
  enc2fa: text("enc_2fa"),
  encEmailPassword: text("enc_email_password"),

  // JSON array of {enc:string, changedAt:number} — keep last 3 rotated credentials.
  passwordHistory: text("password_history"),
  emailPasswordHistory: text("email_password_history"),

  // Microsoft Graph OAuth2 tokens (encrypted). Bound to the Hotmail/Outlook mailbox authorized by user.
  encMsRefreshToken: text("enc_ms_refresh_token"),
  encMsAccessToken: text("enc_ms_access_token"),
  msTokenExpiresAt: integer("ms_token_expires_at"),
  msEmail: text("ms_email"),

  note: text("note"),

  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  videoCount: integer("video_count"),

  // JSON array of last videos: [{ id, coverUrl, viewCount, likeCount, postedAt, caption }]
  lastVideos: text("last_videos"),

  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  lastSyncError: text("last_sync_error"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const facebookAccounts = sqliteTable("facebook_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  username: text("username").notNull(),

  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  statusId: integer("status_id").references(() => statuses.id, { onDelete: "set null" }),
  countryId: integer("country_id").references(() => countries.id, { onDelete: "set null" }),
  machineId: integer("machine_id").references(() => machines.id, { onDelete: "set null" }),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),

  encPassword: text("enc_password"),
  encEmail: text("enc_email"),
  enc2fa: text("enc_2fa"),
  encEmailPassword: text("enc_email_password"),
  encAccessToken: text("enc_access_token"),
  tokenExpiresAt: integer("token_expires_at"),

  passwordHistory: text("password_history"),
  emailPasswordHistory: text("email_password_history"),

  fbUserId: text("fb_user_id"),
  fbName: text("fb_name"),
  fbProfilePic: text("fb_profile_pic"),

  note: text("note"),

  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  lastSyncError: text("last_sync_error"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  // scrypt-hashed password, format `salt$hash` (both base64).
  passwordHash: text("password_hash").notNull(),
  // 'admin' has full access including user mgmt; 'user' is everything else.
  role: text("role").notNull().default("user"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const appSessions = sqliteTable("app_sessions", {
  // 32-byte hex random token, also the cookie value.
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  // unix seconds.
  expiresAt: integer("expires_at").notNull(),
});

// ---------------------------------------------------------------------------
// Insight (Page Reach) — independent of facebook_accounts. Pages themselves
// are never stored: they are listed live from Graph with these tokens.
// ---------------------------------------------------------------------------

export const insightTokens = sqliteTable("insight_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  label: text("label"),
  // 'user' (lists /me/accounts) or 'page' (the token IS one page's token).
  kind: text("kind").notNull().default("user"),
  encToken: text("enc_token").notNull(),
  fbId: text("fb_id"), // user id or page id behind the token
  fbName: text("fb_name"),
  tokenPreview: text("token_preview"),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const insightPageGroups = sqliteTable("insight_page_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#5e6ad2"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// One group per page (per owner). Composite PK (owner_user_id, page_id).
export const insightPageAssignments = sqliteTable("insight_page_assignments", {
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  pageId: text("page_id").notNull(),
  groupId: integer("group_id")
    .notNull()
    .references(() => insightPageGroups.id, { onDelete: "cascade" }),
});

// Last fetched Insight data per owner, so a page reload shows it instantly
// instead of re-reading every page from Graph. kind: 'reach' | 'monet'
// (key = page id) or 'pages' (key = "t:<tokenId>", the token's page list).
export const insightSnapshots = sqliteTable("insight_snapshots", {
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  data: text("data").notNull(), // JSON
  fetchedAt: integer("fetched_at").notNull(), // unix seconds
});

// ---------------------------------------------------------------------------
// Bookmark Key — YouTube channel bookmarks with "new video" badges.
// ---------------------------------------------------------------------------

export const ytGroups = sqliteTable("yt_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#5e6ad2"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ytChannels = sqliteTable("yt_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(), // UC…
  title: text("title").notNull(),
  handle: text("handle"), // @name
  avatar: text("avatar"),
  groupId: integer("group_id").references(() => ytGroups.id, { onDelete: "set null" }),
  note: text("note"),
  // JSON: Array<{ id, title, published (ISO) }> — latest videos from the RSS feed.
  videos: text("videos"),
  lastSeenAt: integer("last_seen_at").notNull(), // unix s: videos after this are "new"
  checkedAt: integer("checked_at"), // unix s: last feed read
  checkError: text("check_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type InsightToken = typeof insightTokens.$inferSelect;
export type InsightPageGroup = typeof insightPageGroups.$inferSelect;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type FacebookAccount = typeof facebookAccounts.$inferSelect;
export type NewFacebookAccount = typeof facebookAccounts.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
export type AppSession = typeof appSessions.$inferSelect;
export type NewAppSession = typeof appSessions.$inferInsert;
