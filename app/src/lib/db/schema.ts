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

export const insightGroups = sqliteTable("insight_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#5e6ad2"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const fanpages = sqliteTable("fanpages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id"),
  fbAccountId: integer("fb_account_id")
    .notNull()
    .references(() => facebookAccounts.id, { onDelete: "cascade" }),
  insightGroupId: integer("insight_group_id").references(() => insightGroups.id, {
    onDelete: "set null",
  }),
  pageId: text("page_id").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  categoryList: text("category_list"),
  about: text("about"),
  description: text("description"),
  pictureUrl: text("picture_url"),
  coverUrl: text("cover_url"),
  link: text("link"),
  username: text("username"),
  fanCount: integer("fan_count"),
  followersCount: integer("followers_count"),
  newLikeCount: integer("new_like_count"),
  ratingCount: integer("rating_count"),
  overallStarRating: text("overall_star_rating"),
  verificationStatus: text("verification_status"),
  tasks: text("tasks"),
  encPageAccessToken: text("enc_page_access_token"),
  insightsJson: text("insights_json"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  lastSyncError: text("last_sync_error"),
  // Monetization (in-stream ad break earnings). `monetization_status`:
  //   'monetized'      → page returned non-zero earnings in the window
  //   'eligible'       → endpoint returned data with all-zero values
  //   'not_monetized'  → endpoint refused (page not onboarded, missing scope)
  //   'unknown'        → never checked
  monetizationStatus: text("monetization_status"),
  monetizationError: text("monetization_error"),
  earningsValue: integer("earnings_value"),       // micro-units (×1_000_000) to avoid float drift
  earningsCurrency: text("earnings_currency"),
  earningsRangeStart: integer("earnings_range_start"),
  earningsRangeEnd: integer("earnings_range_end"),
  earningsUpdatedAt: integer("earnings_updated_at", { mode: "timestamp" }),
  // JSON: Array<{ source, micros, available, error }> — see EarningsSource type.
  earningsBreakdownJson: text("earnings_breakdown_json"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const fanpagePosts = sqliteTable("fanpage_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fanpageId: integer("fanpage_id")
    .notNull()
    .references(() => fanpages.id, { onDelete: "cascade" }),
  postId: text("post_id").notNull(),
  message: text("message"),
  story: text("story"),
  permalinkUrl: text("permalink_url"),
  fullPictureUrl: text("full_picture_url"),
  statusType: text("status_type"),
  createdTime: integer("created_time"),

  reactionsTotal: integer("reactions_total"),
  commentsTotal: integer("comments_total"),
  sharesTotal: integer("shares_total"),

  impressions: integer("impressions"),
  impressionsUnique: integer("impressions_unique"),
  reach: integer("reach"),
  engagedUsers: integer("engaged_users"),
  clicks: integer("clicks"),
  videoViews: integer("video_views"),

  insightsJson: text("insights_json"),
  lastInsightsAt: integer("last_insights_at", { mode: "timestamp" }),
  lastInsightsError: text("last_insights_error"),

  // Per-post ad break earnings (videos only).
  adBreakEarnings: integer("ad_break_earnings"),       // micro-units
  adBreakCurrency: text("ad_break_currency"),
  earningsUpdatedAt: integer("earnings_updated_at", { mode: "timestamp" }),
  earningsError: text("earnings_error"),

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

export const fanpageSnapshots = sqliteTable("fanpage_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fanpageId: integer("fanpage_id")
    .notNull()
    .references(() => fanpages.id, { onDelete: "cascade" }),
  takenAt: integer("taken_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  fanCount: integer("fan_count"),
  followersCount: integer("followers_count"),
  pageImpressions: integer("page_impressions"),
  pageImpressionsUnique: integer("page_impressions_unique"),
  pageEngagements: integer("page_engagements"),
  pageViews: integer("page_views"),
  pageVideoViews: integer("page_video_views"),
  rangeStart: integer("range_start"),
  rangeEnd: integer("range_end"),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type FacebookAccount = typeof facebookAccounts.$inferSelect;
export type NewFacebookAccount = typeof facebookAccounts.$inferInsert;
export type Fanpage = typeof fanpages.$inferSelect;
export type NewFanpage = typeof fanpages.$inferInsert;
export type FanpagePost = typeof fanpagePosts.$inferSelect;
export type NewFanpagePost = typeof fanpagePosts.$inferInsert;
export type InsightGroup = typeof insightGroups.$inferSelect;
export type NewInsightGroup = typeof insightGroups.$inferInsert;
export type FanpageSnapshot = typeof fanpageSnapshots.$inferSelect;
export type NewFanpageSnapshot = typeof fanpageSnapshots.$inferInsert;
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
