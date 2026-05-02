# Phase 04 — Cleanup, Sidebar, Redirects

## Context links
- Plan: [plan.md](plan.md)
- Depends on: Phase 03 (Reach workspace live)

## Overview
- **Date**: 2026-04-20
- **Description**: Port bulk-reassign and bulk-delete from `/fanpage/manage` into `/fanpage`. Update sidebar to 2 sub-items. Replace deprecated routes with 308 redirects. Delete old page files.
- **Priority**: P0
- **Status**: Todo

## Key insights
- Bulk reassign and bulk delete are the only two features of `/fanpage/manage` worth keeping. Both are small additions to the existing toolbar on `/fanpage`.
- Batch-results panel from `/fanpage/manage` is nice UX — port it as a collapsible section shown after sync/delete/reassign actions.
- Next 16 redirects: use `redirects()` in `next.config` OR a `page.tsx` that calls `redirect()` from `next/navigation`. Check `node_modules/next/dist/docs/` for the current recommended pattern before writing.
- Deep links should preserve query strings where possible (e.g. `/insights/reach?ids=1,2` → `/fanpage/reach?ids=1,2&view=reach`).

## Requirements
1. `/fanpage` toolbar gains: "Chuyển chủ sở hữu" dropdown + "Xoá đã chọn" button (only visible when ≥1 row selected).
2. Batch-results collapsible panel rendered after any bulk operation.
3. Sidebar shows only:
   ```
   Quản Lý Fanpage (03)
     a · Danh sách fanpage   → /fanpage
     b · Reach & Insight     → /fanpage/reach
   ```
4. Redirects in place:
   - `/fanpage/manage` → `/fanpage`
   - `/fanpage-groups` → `/fanpage?panel=groups` (or just `/fanpage` if Phase 5 deferred)
   - `/insights` → `/fanpage/reach?view=reach`
   - `/insights/reach` → `/fanpage/reach?view=reach`
   - `/insights/overview` → `/fanpage/reach?view=overview`
5. Old files deleted from `app/src/app/fanpage/manage/`, `app/src/app/fanpage-groups/`, `app/src/app/insights/` (entire subtree). DB left intact.

## Architecture
```
sidebar.tsx
  children: [
    { href: "/fanpage",       label: "Danh sách fanpage", badge: "a" },
    { href: "/fanpage/reach", label: "Reach & Insight",   badge: "b" },
  ]

/fanpage toolbar (new widgets)
  [ Tài khoản chủ ▾ ] [ Chuyển ] [ Xoá đã chọn ]    ← show when selected > 0

redirects (next.config.ts)
  /insights         → /fanpage/reach?view=reach
  /insights/reach   → /fanpage/reach?view=reach
  /insights/overview → /fanpage/reach?view=overview
  /fanpage/manage   → /fanpage
  /fanpage-groups   → /fanpage
```

## Related files
- `app/src/app/_components/sidebar.tsx` — nav array
- `app/src/app/fanpage/page.tsx` — toolbar augmentation
- `app/src/app/fanpage/manage/page.tsx` — source of bulk actions to port
- `app/next.config.ts` (or `.js`) — `redirects()`
- Files to delete: `app/src/app/fanpage/manage/page.tsx`, `app/src/app/fanpage-groups/page.tsx`, entire `app/src/app/insights/` subtree

## Implementation steps
1. Read `node_modules/next/dist/docs/` for Next 16.2.4 redirect API (`next.config` vs. route handler).
2. Port `bulkReassign()`, `bulkDelete()`, and the results-panel UI from `/fanpage/manage/page.tsx` into `/fanpage/page.tsx`. Hide controls behind the existing selection state.
3. Add redirects to `next.config`. Preserve `?ids=...` query string where relevant (Next redirects support regex source + destination with capture groups — verify syntax per docs).
4. Update `sidebar.tsx` nav children to the 2-item list.
5. Smoke-test old URLs produce 308 and land correctly.
6. Delete old page files. Run typecheck + build.
7. Grep for dead imports pointing at deleted files — fix any lingering `<Link href="/fanpage/manage">` etc. `/insights` `<Link>`s inside surviving pages should point to `/fanpage/reach`.

## Todo list
- [ ] Read Next 16 redirect docs
- [ ] Port bulkReassign into `/fanpage`
- [ ] Port bulkDelete into `/fanpage`
- [ ] Port batch-results panel
- [ ] Add `next.config` redirects (5 rules)
- [ ] Update sidebar nav
- [ ] Delete `/fanpage/manage`, `/fanpage-groups`, `/insights/*`
- [ ] Grep + fix dangling `<Link>`s
- [ ] Typecheck + build green
- [ ] Manual: click every old URL, verify redirect + landing

## Success criteria
- Sidebar has 2 sub-items.
- 5 deprecated URLs 308-redirect correctly.
- All unique features from deleted pages reachable from surviving pages.
- `pnpm build` (or equivalent) passes clean.

## Risk assessment
- **Low–medium**. Redirect syntax mismatch for Next 16 is the main pitfall; docs check mitigates. Lost functionality risk mitigated by the audit-driven port list in Phase 01.

## Security considerations
- Bulk delete is destructive — reuse the existing `confirm()` modal. No auth change (local app).

## Next steps
Optional Phase 5 (inline group panel) or close out.
