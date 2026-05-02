# Phase 05 — Avatar + Metrics Worker

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 04](./phase-04-sequential-picker-notes.md)
- Research: [TikTok fetching](./research/researcher-01-tiktok-fetching.md), [architecture stack §4, §6](./research/researcher-02-architecture-stack.md)
- External: [@tobyg74/tiktok-api-dl](https://www.npmjs.com/package/@tobyg74/tiktok-api-dl), [sharp](https://sharp.pixelplumbing.com/), [BullMQ repeatable](https://docs.bullmq.io/guide/jobs/repeatable)

## Overview
- **Date:** 2026-04-19
- **Description:** Implement `fetchProfile(username)` abstraction with primary (tobyg74) + fallback (HTML scrape + proxy). Stand up BullMQ worker with 4h repeatable scan, per-account fetch concurrency 5, avatar → sharp WebP 96x96 → R2, metrics delta → `metrics_snapshots`. Manual "Làm mới ngay" priority queue.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Staggered requests: 500 accounts / 4h = easy; add 200ms delay + ±jitter per request; concurrency 5 comfortable.
- Snapshot before update, so deltas survive.
- Avatar URL unstable → always re-download, hash content; skip R2 upload if hash unchanged.
- Manual refresh enqueued on a `priority` sub-queue (lower priority number wins).
- Circuit breaker: if > 5 consecutive failures, pause worker 10 min.

## Requirements
**Functional**
- Repeatable job `sync-all-accounts` every 4h (`0 */4 * * *`).
- `sync-account` job: fetch profile → update counters + `last_3_videos` + `avatar_url` → insert `metrics_snapshots` row → close `sync_jobs` row.
- On failure: write `last_sync_error`, mark `sync_jobs.status='failed'`, retry 3× exponential.
- Manual endpoint `POST /api/accounts/:id/refresh` enqueues priority `sync-account` and returns job id.
- Avatar pipeline: fetch binary → sharp resize 96x96 WebP Q80 → hash → upload if changed → return public R2 URL.

**Non-Functional**
- Worker concurrency: 5 (`TIKTOK_FETCH_CONCURRENCY`).
- Per-request delay: 200ms + ±100ms jitter (`TIKTOK_FETCH_DELAY_MS`).
- Total scan runtime < 20 min for 500 accounts (well within 4h window).
- Avatar upload < 500ms p95.

## Architecture
```
┌────────── web ──────────┐         ┌────────── worker ──────────┐
│ cron scheduler (BullMQ) │         │ Worker('metrics', ...)     │
│ adds repeatable every 4h│ Upstash │  sync-all-accounts handler │
│ add priority jobs (mnl) │ Redis   │  sync-account handler      │
└─────────────────────────┘         │   └ fetchProfile()         │
                                    │       ├ tobyg74 primary     │
                                    │       └ HTML scrape fallback│
                                    │   └ avatar pipeline → R2    │
                                    │   └ db writes + snapshot    │
                                    └────────────────────────────┘
```

## Related code files
- `packages/shared/src/tiktok/fetcher.ts` (public `fetchProfile`)
- `packages/shared/src/tiktok/primary-tobyg74.ts`
- `packages/shared/src/tiktok/fallback-scrape.ts`
- `packages/shared/src/tiktok/types.ts` (TikTokProfile)
- `packages/shared/src/tiktok/errors.ts`
- `packages/shared/src/avatar/pipeline.ts`
- `packages/shared/src/r2/client.ts`
- `packages/shared/src/queue/index.ts` (Queue factory, names)
- `packages/shared/src/queue/payloads.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/processors/sync-all-accounts.ts`
- `apps/worker/src/processors/sync-account.ts`
- `apps/worker/src/circuit-breaker.ts`
- `apps/web/src/app/api/accounts/[id]/refresh/route.ts`
- `apps/web/src/server/refresh.ts`
- `apps/web/src/app/api/queues/route.ts` (Bull Board, admin-only)

## Implementation Steps
1. Define `TikTokProfile` shape in `packages/shared/src/tiktok/types.ts` matching the spec (`username`, `avatarUrl`, `followerCount`, `followingCount`, `videoCount`, `recentVideos[]`).
2. Implement `primary-tobyg74.ts`: wraps `TikTok.getUserProfile(username)` + `TikTok.getUserPosts(username)`; maps response to `TikTokProfile`; normalizes `postedAt` to `Date`.
3. Implement `fallback-scrape.ts`: GET `https://www.tiktok.com/@{username}` through `PROXY_URL` (if set), parse `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON via regex, extract stats.
4. Implement `fetcher.ts`: `try primary → catch → fallback → catch → throw FetchError`. If `TOBYG74_DISABLED=1` env set, skip primary.
5. Add structured errors in `errors.ts`: `AccountPrivateError`, `AccountNotFoundError`, `RateLimitedError`, `FetchError`.
6. Install `@aws-sdk/client-s3` + `sharp`; write `r2/client.ts` exporting `putObject(key, body, contentType)` using env creds + `region: 'auto'`.
7. Write `avatar/pipeline.ts`: fetch URL → `sharp(buf).resize(96,96,{fit:'cover'}).webp({quality:80}).toBuffer()` → sha256 hash → key `avatars/{accountId}/{hash}.webp` → putObject → return `${R2_PUBLIC_URL}/${key}`; if account already has identical hash suffix, skip upload.
8. In `packages/shared/src/queue/index.ts`, export `metricsQueue` + `Queue` factory, reuse same Upstash connection string.
9. Add queue name constants (`SYNC_ALL_ACCOUNTS`, `SYNC_ACCOUNT`) in `packages/shared/src/queue/payloads.ts` with typed payload interfaces.
10. Scaffold worker entrypoint `apps/worker/src/index.ts`: spawn Workers for `sync-all-accounts` and `sync-account`; concurrency from env; graceful shutdown on SIGTERM (waits for in-flight jobs ≤ 30s).
11. Processor `sync-all-accounts`: fetch active accounts (not soft-deleted), enqueue `sync-account` per account with jittered `delay`, log start/end metrics.
12. Processor `sync-account`: load account, call `fetchProfile(username)`; on success: compare follower/following/video counts → insert `metrics_snapshots` row only if any changed, update accounts row, run avatar pipeline; on failure: set `last_sync_error`, update `sync_jobs`.
13. Add `circuit-breaker.ts`: tracks consecutive failures in Redis key `tiktok:cb:failures`; when ≥5, set pause flag; worker checks flag before each job; cools down 10 min.
14. Ensure `sync_jobs` row created on enqueue and updated on complete/fail; `job_id_bull` stores BullMQ id for traceability.
15. Schedule repeatable job at web startup (singleton via `ensureRepeatableScheduled()` on boot) with `repeat: { pattern: '0 */4 * * *' }` and stable `jobId`.
16. Build `/api/accounts/[id]/refresh` endpoint (manager+ on group): enqueues `sync-account` with `priority: 1` (default 10 for scan) and returns `{ jobId }`.
17. Add Bull Board dashboard at `/api/queues` (admin-only, protected by `requireRole('admin')`).
18. Write vitest for fetcher fallback: mock primary to throw → assert fallback called → mock both throw → assert `FetchError`.
19. Integration test: seed 5 accounts with real usernames (test env only) → run worker → assert DB metrics populated + R2 object uploaded (mock R2 via `aws-sdk-client-mock`).
20. Add Sentry wrap on worker processors; unhandled rejection = crash worker (Railway restarts).
21. Document TikTok fetcher health checklist (weekly GH issue review, response status log) in phase-07 runbook.
22. Add admin UI button on account detail "Làm mới ngay"; shows spinner → polls job until status complete.

## Todo list
- [ ] TikTokProfile types + errors
- [ ] primary tobyg74 adapter
- [ ] fallback scrape adapter
- [ ] fetchProfile() orchestrator
- [ ] R2 client
- [ ] avatar pipeline (sharp, hash, skip-if-same)
- [ ] Queue factory + payload types
- [ ] Worker entrypoint + graceful shutdown
- [ ] sync-all-accounts processor
- [ ] sync-account processor
- [ ] Circuit breaker
- [ ] sync_jobs lifecycle
- [ ] Repeatable registration at boot
- [ ] /refresh priority endpoint
- [ ] Bull Board admin UI
- [ ] Tests (fetcher fallback, integration)
- [ ] Sentry wrapping
- [ ] Manual refresh UI button

## Success Criteria
- 500-account scan completes with < 5% error rate in < 20 min.
- Metrics snapshot rows grow over time (one per changed reading).
- Avatar URLs resolve to 96x96 WebP on R2 public URL.
- Manual refresh returns within 10s on green path.
- Circuit breaker pauses worker after 5 consecutive failures.

## Risk Assessment
- **tobyg74 library breaks** → fallback path; error-rate alert; version pin.
- **Cloudflare blocks fallback too** → `PROXY_URL` env; log 403/429 spike.
- **R2 credentials leaked via logs** → never log headers.
- **Worker OOM on large batches** → stream avatar binary; cap `sharp` concurrency.

## Security Considerations
- Only admin/manager may trigger manual refresh.
- Public R2 URLs expose avatar only; no PII in filenames (use hash).
- Bull Board gated to admin.
- Scraped HTML never logged (may contain tokens).

## Next steps
Proceed to [Phase 06 — Dashboard UI](./phase-06-dashboard-ui.md).
