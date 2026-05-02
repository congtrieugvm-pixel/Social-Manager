# Decisions Log

Date: 2026-04-19
Owner: roland.sok@gmail.com

## Confirmed scope

**App type: READ-ONLY info management (NO automation)**

Supported user actions on accounts:
- View credentials (decrypt on demand, copy-to-clipboard)
- Edit note
- Change status
- Move group
- Delete
- Trigger manual metrics refresh

NOT in scope (explicitly excluded):
- Auto login / browser automation
- Auto post / follow / comment
- Playwright/Puppeteer automation
- 2FA code generation (only stores 2fa_secret for user to copy)

Implication: avoid over-engineering for automation. No proxy-per-account, no session persistence, no browser farm.

## Deferred decisions (user will revise later)

1. TikTok fetch strategy — proceed with `@tobyg74/tiktok-api-dl` only. Fallback (HTML scrape + proxy) deferred until library breaks. Accept risk of temporary metric staleness.
2. Team size / RBAC scope — keep 3-role design (admin/manager/member) from plan. User may simplify later if team stays small.
3. Video `posted_at` — display relative time ("2 ngày trước") if library returns relative; upgrade later if needed.
4. Private-account handling — mark `last_sync_error='account_private'`, keep last snapshot, flag UI warning.
5. Fetch concurrency — stay at 5 concurrent + 200ms delay default; tune after first production week.

## Locked tech choices

- Monorepo: pnpm workspaces (apps/web, apps/worker, packages/shared)
- Neon Paid tier from start ($15/mo) to avoid connection-limit issues
- Single ENCRYPTION_KEY (no KMS) — rotate manually if needed
- Railway deploy (web + worker single repo, Nixpacks auto-detect)
