-- Remove the fanpage management feature and ALL of its data (requested by
-- the owner, 2026-10-11). Irreversible — the rows are not archived.
--
-- Dropped: fanpage_snapshots, fanpage_posts, fanpages, insight_groups.
-- Children first so FK checks pass. The new Insight screen does not store
-- pages: it lists them live from Graph with each Facebook account's token.
--
-- Idempotent (IF EXISTS); safe to re-apply.

DROP TABLE IF EXISTS fanpage_snapshots;
DROP TABLE IF EXISTS fanpage_posts;
DROP TABLE IF EXISTS fanpages;
DROP TABLE IF EXISTS insight_groups;
