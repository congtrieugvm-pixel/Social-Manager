CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`group_id` integer,
	`status_id` integer,
	`country_id` integer,
	`machine_id` integer,
	`employee_id` integer,
	`enc_password` text,
	`enc_email` text,
	`enc_2fa` text,
	`enc_email_password` text,
	`password_history` text,
	`email_password_history` text,
	`enc_ms_refresh_token` text,
	`enc_ms_access_token` text,
	`ms_token_expires_at` integer,
	`ms_email` text,
	`note` text,
	`avatar_url` text,
	`follower_count` integer,
	`following_count` integer,
	`video_count` integer,
	`last_videos` text,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`status_id`) REFERENCES `statuses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_username_unique` ON `app_users` (`username`);--> statement-breakpoint
CREATE TABLE `countries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`color` text DEFAULT '#5e6ad2' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `countries_name_unique` ON `countries` (`name`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#b86a3f' NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_name_unique` ON `employees` (`name`);--> statement-breakpoint
CREATE TABLE `facebook_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`group_id` integer,
	`status_id` integer,
	`country_id` integer,
	`machine_id` integer,
	`employee_id` integer,
	`enc_password` text,
	`enc_email` text,
	`enc_2fa` text,
	`enc_email_password` text,
	`enc_access_token` text,
	`token_expires_at` integer,
	`password_history` text,
	`email_password_history` text,
	`fb_user_id` text,
	`fb_name` text,
	`fb_profile_pic` text,
	`note` text,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`status_id`) REFERENCES `statuses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facebook_accounts_username_unique` ON `facebook_accounts` (`username`);--> statement-breakpoint
CREATE TABLE `fanpage_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fanpage_id` integer NOT NULL,
	`post_id` text NOT NULL,
	`message` text,
	`story` text,
	`permalink_url` text,
	`full_picture_url` text,
	`status_type` text,
	`created_time` integer,
	`reactions_total` integer,
	`comments_total` integer,
	`shares_total` integer,
	`impressions` integer,
	`impressions_unique` integer,
	`reach` integer,
	`engaged_users` integer,
	`clicks` integer,
	`video_views` integer,
	`insights_json` text,
	`last_insights_at` integer,
	`last_insights_error` text,
	`ad_break_earnings` integer,
	`ad_break_currency` text,
	`earnings_updated_at` integer,
	`earnings_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fanpage_id`) REFERENCES `fanpages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fanpage_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fanpage_id` integer NOT NULL,
	`taken_at` integer DEFAULT (unixepoch()) NOT NULL,
	`fan_count` integer,
	`followers_count` integer,
	`page_impressions` integer,
	`page_impressions_unique` integer,
	`page_engagements` integer,
	`page_views` integer,
	`page_video_views` integer,
	`range_start` integer,
	`range_end` integer,
	FOREIGN KEY (`fanpage_id`) REFERENCES `fanpages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fanpages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fb_account_id` integer NOT NULL,
	`insight_group_id` integer,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`category_list` text,
	`about` text,
	`description` text,
	`picture_url` text,
	`cover_url` text,
	`link` text,
	`username` text,
	`fan_count` integer,
	`followers_count` integer,
	`new_like_count` integer,
	`rating_count` integer,
	`overall_star_rating` text,
	`verification_status` text,
	`tasks` text,
	`enc_page_access_token` text,
	`insights_json` text,
	`last_synced_at` integer,
	`last_sync_error` text,
	`monetization_status` text,
	`monetization_error` text,
	`earnings_value` integer,
	`earnings_currency` text,
	`earnings_range_start` integer,
	`earnings_range_end` integer,
	`earnings_updated_at` integer,
	`earnings_breakdown_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fb_account_id`) REFERENCES `facebook_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`insight_group_id`) REFERENCES `insight_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#d94a1f' NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `insight_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#5e6ad2' NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insight_groups_name_unique` ON `insight_groups` (`name`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#3f8fb0' NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machines_name_unique` ON `machines` (`name`);--> statement-breakpoint
CREATE TABLE `statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#7a766a' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statuses_name_unique` ON `statuses` (`name`);