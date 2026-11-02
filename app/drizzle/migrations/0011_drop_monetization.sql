-- Remove the Insight "Kiếm tiền" (monetization) feature and its saved data
-- (requested by the owner, 2026-11-03). Irreversible — rows are not archived.
-- The feature only stored cached Graph results in insight_snapshots (kind 'monet').
DELETE FROM insight_snapshots WHERE kind = 'monet';
