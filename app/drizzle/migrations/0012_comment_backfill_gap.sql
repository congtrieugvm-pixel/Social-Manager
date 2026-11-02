-- Comment tự động: comment older posts too, and space comments out.
-- Additive only.
-- backfill_days: 0 = only posts made after the rule is on; N = also posts of the last N days before that
ALTER TABLE fb_comment_rules ADD COLUMN backfill_days INTEGER NOT NULL DEFAULT 0;
-- gap_minutes: minimum minutes between two comments on the same Page (0 = no wait)
ALTER TABLE fb_comment_rules ADD COLUMN gap_minutes INTEGER NOT NULL DEFAULT 0;
