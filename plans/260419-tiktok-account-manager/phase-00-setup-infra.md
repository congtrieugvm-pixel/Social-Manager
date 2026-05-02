# Phase 00 — Setup & Infrastructure

## Context Links
- Parent: [plan.md](./plan.md)
- Research: [architecture stack](./research/researcher-02-architecture-stack.md)
- External: [Railway Nixpacks](https://docs.railway.com/reference/nixpacks), [Neon + Drizzle](https://orm.drizzle.team/docs/get-started/neon-new), [Upstash Redis](https://upstash.com/docs/redis/overall/getstarted)

## Overview
- **Date:** 2026-04-19
- **Description:** Bootstrap monorepo, provision cloud resources (Neon, Upstash, R2), scaffold Next.js 15 + worker, set up env contract + CI skeleton.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- Railway supports multi-service from single repo via Nixpacks; each service gets its own start cmd. Do NOT put `startCommand` in shared `railway.json`.
- Upstash Fixed plan prevents BullMQ request overage cost.
- Neon HTTP driver OK for RSC reads; use `postgres` (TCP) in worker for long jobs.
- Single `ENCRYPTION_KEY` env sufficient; generate via `openssl rand -base64 32`.

## Requirements
**Functional**
- Monorepo workspace (`apps/web`, `apps/worker`, `packages/shared`).
- `.env.example` documenting every variable.
- Dev scripts: `dev:web`, `dev:worker`, `db:generate`, `db:migrate`.
- GitHub Actions: lint + typecheck + drizzle check on PR.

**Non-Functional**
- Node 20 LTS, pnpm 9.
- Strict TS config across workspaces.
- Husky + lint-staged for pre-commit.

## Architecture
```
e:\TIKTOK MANAGER\
├── apps\
│   ├── web\           Next.js 15 App Router
│   └── worker\        BullMQ worker (node dist/worker.js)
├── packages\
│   └── shared\        Drizzle schema, encryption, tiktok-fetcher, types, queue names
├── drizzle\           Generated SQL migrations
├── .github\workflows\ ci.yml
├── package.json       pnpm workspaces
├── pnpm-workspace.yaml
├── turbo.json         pipelines (build/lint/typecheck)
├── railway.json       pre-deploy: pnpm db:migrate
└── .env.example
```
Key decision: Turborepo optional but recommended for cache + parallel builds.

## Related code files
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- `railway.json`, `.env.example`, `.gitignore`
- `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`
- `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- `apps/worker/package.json`, `apps/worker/src/index.ts`, `apps/worker/tsconfig.json`
- `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/tsconfig.json`
- `drizzle.config.ts`
- `.github/workflows/ci.yml`
- `.husky/pre-commit`

## Implementation Steps
1. Init git, create `pnpm-workspace.yaml` with `apps/*` and `packages/*`; set `packageManager` in root `package.json`.
2. Add root dev deps: `typescript`, `turbo`, `prettier`, `eslint`, `husky`, `lint-staged`.
3. Scaffold `apps/web` via `pnpm create next-app@latest` (TS, App Router, Tailwind, src dir, no ESLint preset — we use workspace ESLint).
4. Install shadcn/ui in `apps/web` (`pnpm dlx shadcn@latest init`), configure `components.json`, wire base tokens.
5. Scaffold `apps/worker` as plain TS Node project: `tsup` for bundling, `src/index.ts` entrypoint with graceful shutdown handler.
6. Scaffold `packages/shared` as internal TS package; exports barrel at `src/index.ts`; add `"exports"` map in its package.json.
7. Create `drizzle.config.ts` at root pointing to `packages/shared/src/db/schema.ts` + `drizzle/` migrations dir.
8. Provision Neon project (free tier, region `aws-ap-southeast-1` / Singapore for VN latency); store `DATABASE_URL`.
9. Provision Upstash Redis (Fixed plan, global); store `REDIS_URL`.
10. Provision Cloudflare R2 bucket `tiktok-manager-avatars`; create API token with object R/W scope; enable public custom domain; collect `R2_*` envs.
11. Generate `ENCRYPTION_KEY` via `openssl rand -base64 32`; store in Railway secret + local `.env.local`.
12. Write `.env.example` enumerating: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, `NODE_ENV`, `SEED_ADMIN_EMAIL=roland.sok@gmail.com`, `SEED_ADMIN_PASSWORD`, `TIKTOK_FETCH_CONCURRENCY=5`, `TIKTOK_FETCH_DELAY_MS=200`, `PROXY_URL`.
13. Create `turbo.json` with pipelines for `build`, `lint`, `typecheck`, `dev` (persistent), caching node_modules-relative.
14. Create `railway.json` with `build.builder=NIXPACKS`, `deploy.preDeployCommand=pnpm --filter shared build && pnpm db:migrate`; no `startCommand` (set per-service in dashboard).
15. Add Railway services: `web` (`pnpm --filter web start`), `worker` (`node apps/worker/dist/index.js`); link same repo + shared env group.
16. Create `.github/workflows/ci.yml`: Node 20, pnpm cache, run `turbo lint typecheck build` on PR.
17. Add `.husky/pre-commit` running `pnpm lint-staged` (prettier + eslint fix on staged files).
18. Add root scripts: `db:generate`, `db:migrate`, `db:studio`, `dev`, `build`, `lint`, `typecheck`.
19. Verify: `pnpm install && pnpm typecheck && pnpm --filter web dev` shows Next.js on :3000; `pnpm --filter worker dev` boots worker stub logging "worker ready".
20. Commit + push to GitHub; connect Railway; trigger first deploy (web may 500 — acceptable, schema comes in phase 02).

## Todo list
- [ ] pnpm workspace + root tooling
- [ ] Scaffold apps/web (Next.js 15 + Tailwind + shadcn)
- [ ] Scaffold apps/worker (tsup + tsx)
- [ ] Scaffold packages/shared
- [ ] drizzle.config.ts
- [ ] Provision Neon, Upstash, R2
- [ ] Generate ENCRYPTION_KEY
- [ ] .env.example complete
- [ ] turbo.json
- [ ] railway.json (no startCommand)
- [ ] Railway services wired (web + worker)
- [ ] GitHub Actions CI
- [ ] Husky + lint-staged
- [ ] Root scripts
- [ ] Local dev smoke test
- [ ] First Railway deploy

## Success Criteria
- `pnpm install` from clean checkout succeeds.
- `pnpm typecheck` green across all workspaces.
- `pnpm --filter web dev` serves the stock Next.js page.
- Railway build logs show both services detected and green.
- All envs in `.env.example` present in Railway.

## Risk Assessment
- **Neon region mismatch** → high latency from VN users. Mitigation: pick `ap-southeast-1`.
- **Railway Nixpacks misdetects worker** → add explicit `nixpacks.toml` per app if needed.
- **pnpm workspace hoisting breaking sharp** → add `.npmrc` with `shamefully-hoist=false`, `node-linker=isolated`.

## Security Considerations
- Never commit `.env.local`; `.gitignore` covers it.
- `ENCRYPTION_KEY` stored only in Railway secret + dev machine; rotate procedure documented in phase 07.
- R2 token scoped to single bucket; no wildcard.

## Next steps
Proceed to [Phase 01 — Auth & RBAC](./phase-01-auth-rbac.md).
