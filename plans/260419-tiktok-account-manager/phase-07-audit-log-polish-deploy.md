# Phase 07 — Audit Log / Polish / Deploy

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 06](./phase-06-dashboard-ui.md)
- External: [Railway deploy](https://docs.railway.com/deploy/deployments), [Upstash rate limit](https://upstash.com/docs/redis/sdks/ratelimit-ts/gettingstarted)

## Overview
- **Date:** 2026-04-19
- **Description:** Finalize audit log writer + viewer page, consolidate rate limiting on Upstash, polish error boundaries + empty/loading states, confirm Railway configuration (web + worker + pre-deploy migrate + seed), run smoke tests, write runbook.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Audit writer should be middleware-ish: a `withAudit()` helper around server actions so every sensitive mutation writes a row without ad-hoc code.
- Upstash `@upstash/ratelimit` is serverless-safe; replace in-memory limiter from phase 01.
- Railway multi-service needs pre-deploy hook only on web (runs DB migrate once).

## Requirements
**Functional**
- `/audit` admin-only page: filter by action, user, target_type, date range; paginated.
- Writer helper auto-captures: login, import, delete, status_change, group_move, sync_trigger, picker_use, reveal_secret.
- Rate limits:
  - `/api/auth/sign-in`: 5 / min / IP
  - `/api/accounts/import`: 1 / min / user
  - `/api/accounts/:id/refresh`: 10 / min / user
  - `/api/accounts/bulk` (refresh action): 3 / min / user
- Global error boundary + 404 + 500 pages (Vietnamese).
- Production healthcheck `/api/health` returning DB + Redis + R2 status.

**Non-Functional**
- Audit query < 300ms with 100k rows (index on `created_at desc` + composite on `(user_id, action)`).
- All server log entries include request id (`x-request-id` or nanoid).
- Railway deploy < 5 min; rollbacks via Railway UI.

## Architecture
```
Server action → withAudit(meta)(handler)
  on success, insert audit_logs row async (non-blocking)

Rate limiter → @upstash/ratelimit instance per endpoint
  identifier: user.id || ip

Railway:
  web service:  pnpm --filter web build && pnpm --filter web start
  worker:       node apps/worker/dist/index.js
  preDeploy:    pnpm --filter shared build && pnpm db:migrate && pnpm --filter web seed:admin
```

## Related code files
- `apps/web/src/server/audit.ts` (`logAudit`, `withAudit` HOF)
- `apps/web/src/app/(dashboard)/audit/page.tsx`
- `apps/web/src/app/(dashboard)/audit/audit-table.tsx`
- `apps/web/src/app/(dashboard)/audit/filters.tsx`
- `apps/web/src/app/api/audit/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/error.tsx`
- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/lib/request-id.ts`
- `railway.json` (final)
- `docs/runbook.md`
- `tests/smoke/smoke.spec.ts`

## Implementation Steps
1. Write `logAudit({ userId, action, targetType, targetId, meta })` in `server/audit.ts`; insert with `now()`; catch + log error but never throw to caller.
2. Write `withAudit(actionMeta)(handler)` HOF: calls handler, on success inserts audit row with derived `targetId` from return value.
3. Refactor existing server actions (delete, status change, group move, picker, import, reveal, refresh) to use `withAudit`; confirm every mutation path covered.
4. Add composite index `(user_id, action)` on `audit_logs` via new migration `drizzle/0002_audit_index.sql`.
5. Build `/audit` admin-only page: table columns time/user/action/target/meta(json popover); filter bar (action select, user select, date-range picker in Vietnamese).
6. Paginate audit via cursor (`created_at`) — 50 rows per page; CSV export button.
7. Install `@upstash/ratelimit` + `@upstash/redis`; write `lib/rate-limit.ts` factory `createLimiter(name, limit, window)` returning `.limit(key)`.
8. Replace in-memory limiter from phase 01 with Upstash-backed limiter on sign-in.
9. Wrap `/api/accounts/import`, `/api/accounts/[id]/refresh`, `/api/accounts/bulk` with their respective limiters; return 429 with `Retry-After` header.
10. Add `apps/web/src/lib/request-id.ts`: middleware injects `x-request-id` (nanoid) on every request; include in server logs.
11. Build `/api/health` route: checks `SELECT 1` on DB, `PING` on Redis, `HEAD` on R2 bucket; returns JSON `{ db, redis, r2, version }`.
12. Create `app/error.tsx` + `app/global-error.tsx` + `app/not-found.tsx` with Vietnamese copy and retry button (`reset()`).
13. Add Sentry (or Axiom) integration behind env flag; capture server + client errors; scrub `password`, `enc_*`, `Authorization` headers.
14. Finalize `railway.json`: set `preDeployCommand` to migrate + seed; confirm no `startCommand`; document service start commands in `docs/runbook.md`.
15. Set Railway env group containing every variable from `.env.example`; link to web + worker services.
16. Enable Railway healthcheck on web pointing at `/api/health` (200 required).
17. Write `docs/runbook.md`: deploy steps, rollback, secret rotation (`ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`), worker restart, TikTok library upgrade checklist.
18. Write smoke tests `tests/smoke/smoke.spec.ts`: login, create group, import 3 accounts, run manual refresh, check audit entries present.
19. Add GitHub Actions job `deploy-smoke.yml`: on successful deploy, wait 30s, hit `/api/health`, run smoke script against staging URL.
20. Dry-run deploy to Railway staging; fix any Nixpacks issues (native `sharp`, `postgres` TLS); promote to prod.
21. Verify 4h repeatable job registered once (no duplicates) by inspecting Redis keys `bull:metrics:repeat:*`.
22. Post-deploy checklist in runbook: first admin login, change seed password, register first 10 accounts, observe first scan succeed.

## Todo list
- [ ] logAudit + withAudit HOF
- [ ] Refactor mutations to use withAudit
- [ ] Audit composite index migration
- [ ] /audit page + filters + CSV export
- [ ] Upstash rate limiter factory
- [ ] Apply limiters to sign-in, import, refresh, bulk
- [ ] Request-id middleware
- [ ] /api/health endpoint
- [ ] error / global-error / not-found pages (vi)
- [ ] Sentry/Axiom integration + scrubbing
- [ ] Final railway.json + env group
- [ ] Railway healthcheck hookup
- [ ] docs/runbook.md
- [ ] smoke tests + deploy-smoke workflow
- [ ] Staging dry-run then prod
- [ ] Verify repeatable job singleton
- [ ] Post-deploy checklist

## Success Criteria
- Every sensitive action appears in `/audit` within 1s of occurrence.
- `/api/health` returns 200 with all subsystems green.
- Rate-limited endpoints return 429 at correct thresholds.
- Railway web + worker green, healthcheck passing.
- Smoke test suite green against staging before prod promote.

## Risk Assessment
- **Audit writes slow mutations** → insert via `after` hook / Promise not awaited on critical path; swallow errors.
- **Sharp native binary missing on Railway** → pin `sharp` to version w/ prebuilt `linuxmusl`; add `apt` packages if Nixpacks complains.
- **Repeatable job duplicated across deploys** → use stable `jobId`; add `remove` + `add` on boot only if scheduler mismatch detected.
- **Secret rotation downtime** → document blue/green via dual-key read during rotation window (deferred; acceptable internal app).

## Security Considerations
- Audit table is append-only; no UPDATE/DELETE API.
- Rate limiter uses user id first, IP fallback to prevent account enumeration.
- Health endpoint does not expose version to unauthenticated callers in prod (gate behind admin or obscure path).
- Sentry DSN kept server-side only for sensitive captures.

## Next steps
Project complete. Handoff to ops: see [docs/runbook.md](../../docs/runbook.md).
