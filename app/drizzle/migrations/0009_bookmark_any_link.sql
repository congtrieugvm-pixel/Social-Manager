-- Bookmark Key nhận link bất kì, không chỉ YouTube.
-- kind: 'youtube' (kênh, RSS của YouTube) | 'tiktok' (@profile, video mới)
--     | 'feed' (trang có RSS/Atom) | 'link' (lưu link, không theo dõi)
-- channel_id giữ vai trò khóa trùng: UC… cho YouTube, 'tiktok:<user>', 'url:<link>'.
ALTER TABLE yt_channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'youtube';
--> statement-breakpoint
ALTER TABLE yt_channels ADD COLUMN url TEXT;
--> statement-breakpoint
ALTER TABLE yt_channels ADD COLUMN feed_url TEXT;
