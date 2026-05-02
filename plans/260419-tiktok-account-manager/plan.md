# TikTok Account Manager — Master Plan

**Date:** 2026-04-19
**Owner:** roland.sok@gmail.com
**Status:** pending

## Goal
Internal webapp to manage ~500 TikTok accounts: bulk import, groups, sequential picker, per-account note, custom statuses, avatar + metrics auto-refresh every 4h, multi-user RBAC, audit log. Vietnamese UI, English code comments.

## Tech Stack
- **Framework:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- **Database:** PostgreSQL (Neon serverless) + Drizzle ORM
- **Auth:** Better-Auth (email/password + admin plugin + custom group perms)
- **Queue:** BullMQ + Upstash Redis (Fixed plan)
- **Storage:** Cloudflare R2 (S3-compat) + sharp → WebP 96x96
- **Encryption:** AES-256-GCM via Node `crypto`, single `ENCRYPTION_KEY`
- **TikTok fetch:** `@tobyg74/tiktok-api-dl` primary → HTML scrape fallback
- **Deploy:** Railway (web + worker services, Nixpacks, single repo)

## Phases

| # | Phase | Status | Progress | Link |
|---|-------|--------|----------|------|
| 00 | Setup & Infra | pending | 0% | [phase-00-setup-infra.md](./phase-00-setup-infra.md) |
| 01 | Auth & RBAC | pending | 0% | [phase-01-auth-rbac.md](./phase-01-auth-rbac.md) |
| 02 | Schema / Accounts / Groups / Statuses | pending | 0% | [phase-02-schema-accounts-groups-statuses.md](./phase-02-schema-accounts-groups-statuses.md) |
| 03 | Bulk Import | pending | 0% | [phase-03-bulk-import.md](./phase-03-bulk-import.md) |
| 04 | Sequential Picker + Notes | pending | 0% | [phase-04-sequential-picker-notes.md](./phase-04-sequential-picker-notes.md) |
| 05 | Avatar + Metrics Worker | pending | 0% | [phase-05-avatar-metrics-worker.md](./phase-05-avatar-metrics-worker.md) |
| 06 | Dashboard UI | pending | 0% | [phase-06-dashboard-ui.md](./phase-06-dashboard-ui.md) |
| 07 | Audit Log / Polish / Deploy | pending | 0% | [phase-07-audit-log-polish-deploy.md](./phase-07-audit-log-polish-deploy.md) |

## Global Success Criteria
- All 500 accounts can be imported via paste, previewed, deduplicated, persisted encrypted.
- Auth works: admin, manager (group-scoped), member; Better-Auth session on SSR + API routes.
- Sequential picker returns N accounts atomically, updating `last_used_at`, no double-pick under concurrency.
- Worker refreshes 500 accounts every 4h without triggering Cloudflare block (>95% success per run).
- Avatars cached as WebP 96x96 on R2, served via public CDN URL.
- Audit log captures login/import/delete/status_change/group_move/sync_trigger.
- Rate limits active on auth + bulk import + manual refresh endpoints.
- Railway deploy: web + worker green; DB migrations run on pre-deploy.

## Non-Functional
- Response time < 300ms on dashboard list (virtualized, 500 rows).
- Secrets at rest: AES-256-GCM with per-record IV; user passwords via Better-Auth default (argon2/bcrypt).
- Encryption key rotation deferred (single env key acceptable for internal data < 2yr).
- Railway cold start < 5s; Worker concurrency 5 (configurable).

## Total Effort Estimate
~72–108h (≈ 2–3 weeks, single developer).

## Research Inputs
- [TikTok fetching strategy](./research/researcher-01-tiktok-fetching.md)
- [Architecture stack validation](./research/researcher-02-architecture-stack.md)
