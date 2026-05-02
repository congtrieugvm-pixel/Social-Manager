# Phase 04 — Sequential Picker + Notes

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 03](./phase-03-bulk-import.md)

## Overview
- **Date:** 2026-04-19
- **Description:** Implement the "lấy N kế tiếp" feature: atomically pick N accounts with oldest `last_used_at`, mark them used, show user credentials with copy-to-clipboard. Add auto-saving per-account note field.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Atomic pick requires `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE ... RETURNING` in a single transaction to prevent two users picking the same account.
- Note auto-save uses debounced PATCH (800ms) with optimistic UI.
- Picker may be scoped by group and status filter.

## Requirements
**Functional**
- Button "Lấy N kế tiếp" on dashboard + standalone `/picker` page.
- Inputs: N (1–50), group filter (optional), status filter (optional).
- Output: modal showing up to N accounts with user/pass/email/2fa revealed, each field has copy button and a "Copy all" button formatted `user|pass|email|2fa|email_pass`.
- On successful pick, backend sets `last_used_at = now()` atomically.
- Picker writes `audit_logs` entry per pick (action=`picker_use`, meta={count, ids}).
- Account detail page gets a note editor (multiline textarea, 2 000 char cap) with "Đã lưu" indicator.

**Non-Functional**
- Pick API returns < 500ms for N=50 over 500 accounts.
- Concurrent pickers never receive overlapping accounts.
- Rate limit: 30 picks/min/user.

## Architecture
```
POST /api/picker
  body: { n, groupId?, statusId? }
  tx BEGIN
    SELECT id FROM accounts
      WHERE (group_id = $1 OR $1 IS NULL)
        AND (status_id = $2 OR $2 IS NULL)
        AND user has view+ on group
      ORDER BY last_used_at NULLS FIRST, sort_order
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    UPDATE accounts SET last_used_at=now() WHERE id = ANY(...)
    RETURNING ...
  tx COMMIT
  → decrypt + return
```

## Related code files
- `apps/web/src/app/(dashboard)/picker/page.tsx`
- `apps/web/src/app/(dashboard)/picker/picker-dialog.tsx`
- `apps/web/src/app/(dashboard)/picker/result-card.tsx`
- `apps/web/src/app/api/picker/route.ts`
- `apps/web/src/server/picker.ts`
- `apps/web/src/app/(dashboard)/accounts/[id]/note-editor.tsx`
- `apps/web/src/app/api/accounts/[id]/note/route.ts`
- `packages/shared/src/db/queries/picker.ts` (raw SQL builder)

## Implementation Steps
1. Write `packages/shared/src/db/queries/picker.ts` exposing `pickNext(db, { userId, n, groupId?, statusId?, allowedGroupIds })` using Drizzle `sql` template + `FOR UPDATE SKIP LOCKED`.
2. In the same transaction, `UPDATE accounts SET last_used_at = now() WHERE id IN (...)` returning full row.
3. For admin callers, `allowedGroupIds` is `null` (bypass); else compute via `account_permissions` join where `permission IN ('view','edit','manage')`.
4. Create `server/picker.ts` server action that wraps the query, decrypts `password`, `email`, `twoFaSecret`, `emailPassword`, and returns sanitized DTO.
5. Expose `POST /api/picker` → calls server action; validate body via zod: `n >= 1 && n <= 50`.
6. Emit audit log per call with `action='picker_use'`, `meta={count: picked.length, accountIds}`.
7. Build `/picker` page with form (N, group, status dropdowns) + primary button "Lấy kế tiếp".
8. On submit, open `<PickerDialog>` modal listing `<ResultCard>` per account.
9. `<ResultCard>` shows username, masked → reveal toggle, copy icon per field, one "Copy all (pipe-format)" button using navigator.clipboard.
10. After dialog close, invalidate `/accounts` list cache via `revalidatePath('/accounts')`.
11. Add "Lấy N kế tiếp" quick-action button on `/accounts` header that opens the same dialog.
12. Rate limit picker endpoint: 30/min/user.
13. Build note editor component `<NoteEditor>` using shadcn `Textarea` + debounced `useEffect` (800ms) calling `PATCH /api/accounts/[id]/note`.
14. Show saving indicator: "Đang lưu…" / "Đã lưu lúc HH:mm" / error toast.
15. Server route validates ownership via RBAC; writes `notes` column; returns `updatedAt`.
16. Add OptimisticUI: show instantly, rollback on error.
17. Character counter (max 2 000) with Vietnamese helper "Tối đa 2000 ký tự".
18. Write Playwright test: two parallel `pick` requests with N=50 → zero overlap, total 100 distinct accounts.
19. Write unit test for note auto-save: mock timers, assert single PATCH after burst of typing.
20. Add Sentry breadcrumb on pick (no plaintext).

## Todo list
- [ ] pickNext raw SQL query
- [ ] server/picker.ts wrapper
- [ ] /api/picker route + zod
- [ ] Audit entry
- [ ] /picker page + form
- [ ] PickerDialog + ResultCard
- [ ] Copy-to-clipboard (field + all)
- [ ] Header button on /accounts
- [ ] Rate limit
- [ ] NoteEditor component
- [ ] /api/accounts/[id]/note
- [ ] Optimistic save + char counter
- [ ] Concurrency Playwright test
- [ ] Note auto-save unit test

## Success Criteria
- 2 concurrent pickers N=50 → no overlap (verified by test).
- `last_used_at` strictly updated for picked accounts.
- Copy all produces exact `user|pass|email|2fa|email_pass` string.
- Note saves silently in < 1s after stop typing.

## Risk Assessment
- **Lock contention** → `SKIP LOCKED` ensures non-blocking.
- **Clipboard API in insecure context** → enforce HTTPS; fallback `document.execCommand` if unavailable.
- **Debounce race (unload before save)** → beforeunload listener flushes pending save.

## Security Considerations
- Picker reveals plaintext secrets — must be RBAC-gated + audited.
- Clipboard does not traverse network; still warn "Sao chép sẽ hiện bản rõ".
- Note may contain sensitive free-text — included in audit for delete events only.

## Next steps
Proceed to [Phase 05 — Avatar + Metrics Worker](./phase-05-avatar-metrics-worker.md).
