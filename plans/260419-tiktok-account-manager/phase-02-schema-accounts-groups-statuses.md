# Phase 02 — Schema / Accounts / Groups / Statuses

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 01](./phase-01-auth-rbac.md)
- Research: [architecture stack §3, §5](./research/researcher-02-architecture-stack.md)
- External: [Drizzle schema](https://orm.drizzle.team/docs/sql-schema-declaration), [Node crypto AES-GCM](https://nodejs.org/api/crypto.html#class-cipher)

## Overview
- **Date:** 2026-04-19
- **Description:** Design full relational schema (users, groups, statuses, accounts, account_permissions, metrics_snapshots, sync_jobs, audit_logs). Ship AES-256-GCM encryption helper. Build basic CRUD APIs + minimal UI for accounts / groups / statuses. Foundation for subsequent phases.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- AES-256-GCM: 12-byte IV, 16-byte auth tag; store `iv+tag+ciphertext` concatenated OR split columns — we split for clarity (per spec).
- `last_3_videos` as JSONB for flexible shape without an extra table.
- Composite PK on `account_permissions(user_id, group_id)`.
- Drizzle enums: `pgEnum('role', ['admin','manager','member'])`, `pgEnum('permission', ['view','edit','manage'])`, `pgEnum('sync_status', ['queued','running','success','failed'])`.

## Requirements
**Functional**
- All sensitive fields encrypted at rest (password, email, 2fa_secret, email_password).
- Admin CRUD on groups + statuses (label/color/icon/order).
- Accounts CRUD (admin or manager w/ `edit`+ on group).
- Account_permissions grants manager/member scoped access.

**Non-Functional**
- Drizzle migrations versioned in `drizzle/`.
- All FK cascades defined explicitly.
- `audit_logs.created_at` descending index.
- Avg encrypt/decrypt round-trip < 1ms.

## Architecture
```
packages/shared/src/
├── db/
│   ├── schema/
│   │   ├── auth.ts              (phase 01)
│   │   ├── groups.ts
│   │   ├── statuses.ts
│   │   ├── accounts.ts
│   │   ├── permissions.ts
│   │   ├── metrics.ts
│   │   ├── sync.ts
│   │   ├── audit.ts
│   │   └── index.ts             barrel re-export + relations
│   └── client.ts
├── encryption.ts
├── types.ts                     Row types, EncryptedField
└── index.ts
```

## Related code files
- `packages/shared/src/db/schema/groups.ts`
- `packages/shared/src/db/schema/statuses.ts`
- `packages/shared/src/db/schema/accounts.ts`
- `packages/shared/src/db/schema/permissions.ts`
- `packages/shared/src/db/schema/metrics.ts`
- `packages/shared/src/db/schema/sync.ts`
- `packages/shared/src/db/schema/audit.ts`
- `packages/shared/src/db/schema/index.ts`
- `packages/shared/src/encryption.ts`
- `packages/shared/src/types.ts`
- `drizzle/0001_init.sql` (generated)
- `apps/web/src/app/(dashboard)/accounts/page.tsx`
- `apps/web/src/app/(dashboard)/accounts/[id]/page.tsx`
- `apps/web/src/app/(dashboard)/groups/page.tsx`
- `apps/web/src/app/(dashboard)/statuses/page.tsx`
- `apps/web/src/app/api/accounts/route.ts`
- `apps/web/src/app/api/accounts/[id]/route.ts`
- `apps/web/src/app/api/groups/route.ts`
- `apps/web/src/app/api/statuses/route.ts`
- `apps/web/src/server/accounts.ts` (server actions)
- `apps/web/src/server/groups.ts`
- `apps/web/src/server/statuses.ts`

## Schema columns (authoritative)
- **users** — (extends Better-Auth user) + `role` enum.
- **groups** (id uuid pk, name text unique, color text, description text, created_by uuid fk users, created_at timestamptz default now()).
- **statuses** (id uuid pk, label text, color text, icon text, order int, created_by fk users, created_at timestamptz).
- **accounts** (id uuid pk, username text unique, enc_password text, enc_password_iv text, enc_email text, enc_email_iv text, enc_2fa_secret text, enc_2fa_iv text, enc_email_password text, enc_email_pass_iv text, group_id uuid fk groups null, status_id uuid fk statuses null, note text, avatar_url text, follower_count int, following_count int, video_count int, last_3_videos jsonb, last_synced_at timestamptz, last_sync_error text, last_used_at timestamptz, sort_order int, created_by fk users, created_at timestamptz, updated_at timestamptz).
- **account_permissions** (user_id uuid fk users, group_id uuid fk groups, permission enum view|edit|manage, pk(user_id, group_id)).
- **metrics_snapshots** (id uuid pk, account_id uuid fk accounts, follower_count int, following_count int, video_count int, taken_at timestamptz, index(account_id, taken_at desc)).
- **sync_jobs** (id uuid pk, account_id fk accounts, job_id_bull text, status enum, error text, started_at, finished_at).
- **audit_logs** (id uuid pk, user_id fk users null, action text, target_type text, target_id uuid, meta jsonb, created_at timestamptz default now(), index(created_at desc)).

## Implementation Steps
1. Write `packages/shared/src/encryption.ts` exporting `encrypt(plaintext): { ciphertext, iv }` and `decrypt(ciphertext, iv): string`. Use `aes-256-gcm`, 12-byte IV; append auth tag to ciphertext; both values stored base64.
2. Add `encryptField(obj, keys)` helper and `decryptField` helper mapping camelCase plaintext ↔ `enc_*` + `enc_*_iv` columns for ergonomic ORM use.
3. Unit-test encryption: round-trip 100 random strings; tamper ciphertext → expect `decipher.final` throw.
4. Declare pgEnums in `packages/shared/src/db/schema/enums.ts`: `roleEnum`, `permissionEnum`, `syncStatusEnum`.
5. Write `schema/groups.ts` with `pgTable('groups', …)` + relations.
6. Write `schema/statuses.ts` + relations.
7. Write `schema/accounts.ts` as per column spec; mark `username` unique; include soft FKs to groups/statuses with `onDelete: 'set null'`.
8. Write `schema/permissions.ts` with composite PK via `primaryKey({ columns: [userId, groupId] })`.
9. Write `schema/metrics.ts` with `.index('metrics_account_taken_idx').on(accountId, takenAt.desc())`.
10. Write `schema/sync.ts` + `schema/audit.ts` (with `createdAt` desc index).
11. Barrel re-export all schemas + relations from `schema/index.ts`.
12. Run `pnpm db:generate` → review generated SQL → commit `drizzle/0001_init.sql`.
13. Run `pnpm db:migrate` against Neon dev branch; verify tables via `drizzle-kit studio`.
14. Build server actions `server/groups.ts` (create/update/delete/list) with admin-only guard.
15. Build server actions `server/statuses.ts` (create/update/delete/list/reorder).
16. Build server actions `server/accounts.ts` with create/update/delete/list; on create encrypt sensitive fields; on read decrypt only when viewer has `view`+.
17. Expose REST routes at `/api/accounts`, `/api/groups`, `/api/statuses` calling the same server functions (used by fetch clients / tests).
18. Build minimal pages `/groups`, `/statuses`, `/accounts` with shadcn `DataTable` + `Dialog` for CRUD; Vietnamese labels ("Nhóm", "Trạng thái", "Tài khoản").
19. Account detail page `/accounts/[id]` shows decrypted fields behind "Hiện mật khẩu" / "Hiện 2FA" toggle (admin/manager only); each reveal writes an `audit_log`.
20. Permission editor UI (admin-only) `/groups/[id]/permissions`: assign user → group → permission level.
21. Add zod schemas for every server action input; throw friendly errors.
22. Write integration test: create group → create account in group → grant manager `edit` → manager can update; member denied.

## Todo list
- [ ] encryption.ts + unit tests
- [ ] enums.ts
- [ ] groups / statuses / accounts / permissions / metrics / sync / audit schemas
- [ ] schema barrel
- [ ] Initial migration
- [ ] Server actions: groups, statuses, accounts
- [ ] REST routes
- [ ] Pages: /groups /statuses /accounts /accounts/[id]
- [ ] Permission editor
- [ ] Zod input validation
- [ ] RBAC-scoped reveal + audit emit
- [ ] Integration tests

## Success Criteria
- `pnpm db:migrate` green.
- CRUD round-trip for groups/statuses/accounts.
- Encrypted fields never appear in logs; DB stores only ciphertext.
- Member cannot read accounts in ungranted group (403).

## Risk Assessment
- **IV or tag mishandled** → data unrecoverable. Mitigation: unit tests + tamper test.
- **Migration drift** → enforce PR check `drizzle-kit check`.
- **Group delete orphans accounts** → `onDelete: set null` for `group_id`; UI confirms.

## Security Considerations
- `ENCRYPTION_KEY` loaded once at module init; throw if missing/wrong length.
- `decrypt` errors sanitized (do not echo ciphertext).
- Only admin/manager with `view`+ may decrypt.
- Audit every reveal action: `action='reveal_secret'`, `meta={field}`.

## Next steps
Proceed to [Phase 03 — Bulk Import](./phase-03-bulk-import.md).
