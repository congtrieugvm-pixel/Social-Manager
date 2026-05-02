# Phase 03 — Bulk Import

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 02](./phase-02-schema-accounts-groups-statuses.md)
- External: [BullMQ jobs](https://docs.bullmq.io/guide/jobs)

## Overview
- **Date:** 2026-04-19
- **Description:** Paste-based bulk import. User pastes lines `user|pass|email|2fa|pass_email`, sees preview with validation + duplicate flags, selects a target group/status, then commits. Rows > 100 trigger a background BullMQ job with live progress.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Parser must tolerate Windows/Unix newlines, trim whitespace, skip blanks, flag malformed rows.
- Dedup key = TikTok `username` (case-insensitive).
- Encryption happens server-side inside the job — plaintext never persisted.
- Large batches encrypt in chunks of 50 to avoid blocking event loop.

## Requirements
**Functional**
- Textarea accepting multi-line paste.
- Preview table: row#, username, masked password (`••••••`), email, 2fa (present?), email_password (present?), status (new/duplicate/invalid).
- Target group + default status selectable before commit.
- Commit ≤ 100 rows inline; > 100 rows queued.
- Progress UI (0–100%, current row, success count, error list).
- Audit log: one `bulk_import` entry with `meta={total, succeeded, failed}`.

**Non-Functional**
- Rate-limit: 1 import job per user per minute.
- Max 10 000 rows per paste (hard cap).
- Import job idempotent via `jobId = hash(userId+firstLine+count)`.

## Architecture
```
User → /accounts/import
  Client: parse + preview (zod per row)
  Commit:
    n ≤ 100 → server action bulkCreateAccounts (sync)
    n > 100 → enqueue 'import-accounts' on BullMQ
  Worker reads batch, encrypts, inserts, updates progress via Redis pub/sub
  Client subscribes via /api/import/status?jobId= (SSE or polling)
```

## Related code files
- `apps/web/src/app/(dashboard)/accounts/import/page.tsx`
- `apps/web/src/app/(dashboard)/accounts/import/preview-table.tsx`
- `apps/web/src/app/(dashboard)/accounts/import/progress.tsx`
- `apps/web/src/server/import.ts` (server actions)
- `apps/web/src/app/api/import/status/route.ts` (SSE)
- `packages/shared/src/import/parser.ts`
- `packages/shared/src/import/types.ts`
- `packages/shared/src/queue/names.ts` (shared queue name consts)
- `packages/shared/src/queue/import-payload.ts`
- `apps/worker/src/processors/import-accounts.ts`

## Implementation Steps
1. Write parser `parseBulkAccounts(raw: string): ParsedRow[]` in `packages/shared/src/import/parser.ts` — splits lines, trims, splits by `|`, emits `{ lineNumber, raw, parsed?: {...}, error?: string }`.
2. Validate each parsed row with zod: username 2–24 chars `[a-zA-Z0-9_.]`, password 1+ char, email valid, 2fa optional, email_password optional.
3. Create `/accounts/import/page.tsx` with shadcn `Textarea`, `Select` for group + default status, `Button` "Xem trước".
4. On preview click, call the parser on client side; display `preview-table.tsx` with colored status badges (new/duplicate/invalid).
5. Fetch existing usernames via server action `checkDuplicateUsernames(names[])`; mark duplicates.
6. Allow toggling per-row skip; summary bar shows counts.
7. On "Nhập" (commit): if valid count ≤ 100 call `bulkCreateAccounts` server action (encrypts + inserts in a single Drizzle transaction, 20/batch).
8. If > 100 rows, enqueue BullMQ job `import-accounts` with payload `{ userId, rows, groupId, statusId }`; redirect to progress page with `jobId`.
9. Register `import-accounts` queue name in `packages/shared/src/queue/names.ts` so both web and worker share the string.
10. Implement worker processor `apps/worker/src/processors/import-accounts.ts`: loops rows, encrypts, inserts in batches of 20, calls `job.updateProgress(pct)`, writes to DB with `createdBy=userId`.
11. Handle per-row failure: catch + push to `errors[]` in job return; continue processing remaining rows (do not fail entire job).
12. At job end, write `audit_logs` entry: action=`bulk_import`, target_type=`accounts`, meta={ total, succeeded, failed, errors: errors.slice(0,20) }.
13. Build SSE endpoint `/api/import/status?jobId=`: uses BullMQ `QueueEvents` to stream `progress`, `completed`, `failed`; protect by user ownership (`job.data.userId === session.user.id` or admin).
14. Progress UI component polls/subscribes every 1s via SSE; on complete shows summary + link back to `/accounts`.
15. Rate-limit server action: 1 import per user per 60s using Upstash-based counter.
16. Hard-cap 10 000 rows on server side; reject with 413 else.
17. Add Vietnamese labels: "Nhập hàng loạt", "Dán danh sách", "Xem trước", "Nhập", "Đang xử lý", "Hoàn tất".
18. Write unit tests for parser (edge cases: empty lines, extra pipes, missing fields, CRLF).
19. Write integration test: enqueue 250-row job, assert DB has 250 rows, audit entry logged, progress reached 100%.
20. Add feature flag `IMPORT_ASYNC_THRESHOLD=100` so it can be tuned without redeploy.

## Todo list
- [ ] parser.ts + zod validation
- [ ] Import page + preview UI
- [ ] Duplicate check server action
- [ ] bulkCreateAccounts (sync ≤100)
- [ ] Queue name + payload types
- [ ] import-accounts worker processor
- [ ] SSE status endpoint
- [ ] Progress UI
- [ ] Rate limit
- [ ] Hard row cap
- [ ] Vietnamese labels
- [ ] Audit log on commit
- [ ] Unit tests for parser
- [ ] Integration test (250 rows)
- [ ] Feature flag threshold

## Success Criteria
- Paste 500 sample rows → preview in < 2s client-side.
- Commit 500 rows via worker → completes < 60s, 0 failures on valid data.
- Duplicate usernames flagged and skipped.
- Audit log row produced with correct counts.
- Non-owner cannot read other user's job status.

## Risk Assessment
- **Encrypt CPU block event loop** → chunk + `await setImmediate()` between batches.
- **Worker crash mid-job** → BullMQ `attempts: 3`, backoff exponential; job resumes but duplicate inserts prevented by `username` unique constraint (catch + skip).
- **Paste contains BOM** → strip at parser start.

## Security Considerations
- Plaintext row data lives only in job payload (Redis, TLS). Purge job after 24h via `removeOnComplete: { age: 86400 }`.
- SSE endpoint must authorize viewer.
- Do not echo plaintext password in error messages.

## Next steps
Proceed to [Phase 04 — Sequential Picker + Notes](./phase-04-sequential-picker-notes.md).
