# Phase 01 — Auth & RBAC

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 00](./phase-00-setup-infra.md)
- Research: [architecture stack §2](./research/researcher-02-architecture-stack.md)
- External: [Better-Auth docs](https://www.better-auth.com/docs), [Better-Auth admin plugin](https://www.better-auth.com/docs/plugins/admin)

## Overview
- **Date:** 2026-04-19
- **Description:** Integrate Better-Auth (email/password + admin plugin) with Drizzle adapter. Define three-tier role system (admin/manager/member) plus group-scoped permission table. Build login UI (Vietnamese), session middleware, route guards, and seed the first admin user.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Better-Auth admin plugin gives role field + user management APIs; group-scoped perms need our own `account_permissions` table joined at query time.
- httpOnly cookie + DB session fallback (default Better-Auth behaviour) enables explicit revocation.
- CSRF protection + rate limiting built in; enable both.
- Seed admin via idempotent script run once on first boot (`SEED_ADMIN_EMAIL` env).

## Requirements
**Functional**
- Email/password sign-in only (no OAuth yet).
- Roles: `admin`, `manager`, `member` (enum).
- Admin: full access. Manager: scoped via `account_permissions`. Member: read-only within assigned groups.
- `/login` page (Vietnamese labels: "Đăng nhập", "Mật khẩu", "Ghi nhớ").
- Session accessible in RSC, route handlers, server actions.
- Middleware redirects unauthenticated to `/login` (except `/api/auth/*`, `/login`).

**Non-Functional**
- Login endpoint rate-limited: 5/min per IP.
- Failed login attempts never leak whether user exists.

## Architecture
```
apps/web
├── src/lib/auth.ts            betterAuth() factory w/ drizzleAdapter + admin plugin
├── src/lib/session.ts         getSession(), requireRole(), requireGroupPerm()
├── src/middleware.ts          redirect guard
├── src/app/api/auth/[...all]/route.ts  auth handler
├── src/app/login/page.tsx     form (shadcn)
└── scripts/seed-admin.ts      one-shot seed

packages/shared
└── src/db/schema/auth.ts      Better-Auth tables + users.role enum
```
Decision: Better-Auth tables (user, session, account, verification) live in `packages/shared/src/db/schema/auth.ts`; domain tables (groups, accounts…) in other files (phase 02).

## Related code files
- `packages/shared/src/db/schema/auth.ts`
- `packages/shared/src/db/schema/index.ts`
- `apps/web/src/lib/auth.ts`
- `apps/web/src/lib/auth-client.ts` (client SDK)
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/rbac.ts`
- `apps/web/src/middleware.ts`
- `apps/web/src/app/api/auth/[...all]/route.ts`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/login/login-form.tsx`
- `apps/web/src/app/(dashboard)/layout.tsx` (guarded shell)
- `apps/web/scripts/seed-admin.ts`
- `packages/shared/src/db/client.ts`

## Implementation Steps
1. Install in web: `better-auth`, `@better-auth/cli`; in shared: `drizzle-orm`, `drizzle-kit`, `postgres`, `@neondatabase/serverless`.
2. Create `packages/shared/src/db/client.ts` exporting `db` via `drizzle(postgres(DATABASE_URL))` with lazy singleton.
3. Define Better-Auth schema with `@better-auth/cli generate` or hand-write `user`, `session`, `account`, `verification` tables in `packages/shared/src/db/schema/auth.ts`.
4. Extend `user` table with `role: text('role').notNull().default('member')` — enum enforced at app layer.
5. Create `apps/web/src/lib/auth.ts`: `betterAuth({ database: drizzleAdapter(db, { provider: 'pg' }), emailAndPassword: { enabled: true }, plugins: [admin()], secret: BETTER_AUTH_SECRET, baseURL: BETTER_AUTH_URL })`.
6. Create `apps/web/src/lib/auth-client.ts`: `createAuthClient({ baseURL })` + `adminClient()` for role mgmt in UI.
7. Create route handler `apps/web/src/app/api/auth/[...all]/route.ts` → `export const { GET, POST } = toNextJsHandler(auth)`.
8. Create `apps/web/src/lib/session.ts` with `getSession()` reading `headers()`; cache per request with `React.cache`.
9. Create `apps/web/src/lib/rbac.ts` with `requireRole(role)`, `requireGroupPermission(groupId, level)`; `level: 'view' | 'edit' | 'manage'`; admin bypasses.
10. Create `apps/web/src/middleware.ts`: match all except `/api/auth`, `/login`, static; call Better-Auth `getSession` via cookie; redirect to `/login` if absent.
11. Build `/login` page using shadcn `Card` + `Form` + `Input` + `Button`; client-side submit via `authClient.signIn.email`.
12. Vietnamese labels: "Đăng nhập", "Email", "Mật khẩu", "Nhập lại", error toast "Sai email hoặc mật khẩu".
13. Guard `(dashboard)` route group layout: call `getSession()`; if none → `redirect('/login')`; pass user to client via context.
14. Write `apps/web/scripts/seed-admin.ts`: read `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`; call `auth.api.signUpEmail` if user missing; then set `role='admin'` via direct DB update.
15. Wire seed script into `railway.json` pre-deploy AFTER `db:migrate`: `pnpm --filter web seed:admin`.
16. Add rate-limit middleware for `/api/auth/sign-in/*`: 5 req / 60s / IP using simple in-memory for now (Upstash-backed upgrade in phase 07).
17. Add `/logout` action that calls `authClient.signOut` and redirects `/login`.
18. Add `<UserMenu />` shadcn component in dashboard header showing email + role + logout.
19. Smoke test: sign in with seeded admin → reach `/` → see role badge; sign out → back to `/login`.
20. Write vitest unit tests for `requireRole` and `requireGroupPermission` using fake session objects.

## Todo list
- [ ] Install Better-Auth + Drizzle deps
- [ ] db/client.ts singleton
- [ ] Auth schema (user/session/account/verification) + `role` column
- [ ] lib/auth.ts factory
- [ ] lib/auth-client.ts
- [ ] API route handler `/api/auth/[...all]`
- [ ] lib/session.ts with React.cache
- [ ] lib/rbac.ts guards
- [ ] middleware.ts route guard
- [ ] /login page + form (VN labels)
- [ ] (dashboard) layout guard
- [ ] seed-admin.ts script
- [ ] Wire seed into pre-deploy
- [ ] Rate limit on sign-in
- [ ] Logout + UserMenu
- [ ] Smoke test + unit tests

## Success Criteria
- Fresh DB → seed script creates admin `roland.sok@gmail.com`.
- Cannot reach any dashboard route without session.
- Admin sees all; member blocked from admin-only UI.
- Auth endpoints respond < 200ms warm.
- Rate limit returns 429 after 5 failed attempts.

## Risk Assessment
- **Admin plugin API churn** → pin `better-auth` minor version; smoke-test on upgrade.
- **Group-scoped perms not native** → implement in app layer via `account_permissions` (phase 02).
- **Middleware & DB lookups on every request** → Better-Auth uses session cookie + cached session; OK.

## Security Considerations
- `BETTER_AUTH_SECRET` ≥ 32 bytes random; rotate on incident.
- Set `secure`, `httpOnly`, `sameSite=lax` cookies (Better-Auth default in prod).
- Never log passwords; confirm Better-Auth masks.
- Seed password must be changed on first login — add forced-reset flag on seed user.

## Next steps
Proceed to [Phase 02 — Schema / Accounts / Groups / Statuses](./phase-02-schema-accounts-groups-statuses.md).
