-- Multi-tenant fix for insight_groups.name uniqueness.
--
-- Migration 0002 made insight_groups owner-scoped (added owner_user_id) but
-- did NOT update the legacy global UNIQUE index `insight_groups_name_unique`.
-- Effect: any new tenant trying to create a group with a name another tenant
-- already used hit a SQLite UNIQUE constraint and the route returned
-- "Tên nhóm đã tồn tại". Symptom for the user: "không tạo nhóm gán page được".
--
-- Fix: drop the global index, replace with a composite (owner_user_id, name)
-- unique. NULL owner_user_id rows are allowed to repeat per SQLite's standard
-- UNIQUE-with-NULL semantics, but 0002 backfilled all rows to the first admin
-- so this shouldn't matter in practice.
--
-- Both DDL statements are idempotent; safe to re-apply.

DROP INDEX IF EXISTS insight_groups_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS insight_groups_owner_name_unique
  ON insight_groups (owner_user_id, name);
