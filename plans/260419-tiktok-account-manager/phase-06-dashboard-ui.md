# Phase 06 — Dashboard UI

## Context Links
- Parent: [plan.md](./plan.md)
- Previous: [Phase 05](./phase-05-avatar-metrics-worker.md)
- External: [TanStack Table](https://tanstack.com/table/v8), [TanStack Virtual](https://tanstack.com/virtual/latest), [shadcn Data Table](https://ui.shadcn.com/docs/components/data-table)

## Overview
- **Date:** 2026-04-19
- **Description:** Deliver the primary accounts dashboard: virtualized data table, multi-filter bar, bulk actions (move group / change status / delete / refresh selected), grid ↔ table view toggle, full-text username/note search, server-side pagination fallback for huge datasets. Vietnamese UI polish.
- **Priority:** high
- **Impl status:** pending
- **Review status:** pending

## Key Insights
- TanStack Table + `@tanstack/react-virtual` handles 500 rows @ 60fps on modest hardware.
- Filter state lives in URL (`nuqs` or `useSearchParams`) so views are bookmarkable.
- Grid view is a simple card grid under the same dataset, using identical filter state.
- Bulk actions operate on selected IDs via server actions.

## Requirements
**Functional**
- Columns: avatar, username, group, status, followers, videos, last_synced_at, last_used_at, actions.
- Sortable by follower count, last_synced_at, last_used_at, username.
- Filter combo: group (multi-select), status (multi-select), last_synced ("< 4h", "4–24h", "> 24h"), has_error (boolean).
- Search: username or note substring (debounced 300ms).
- Bulk select w/ shift-click range; bulk action toolbar.
- Toggle table ↔ grid (localStorage persisted).
- Pagination: client side up to 1 000 rows; else server cursor.

**Non-Functional**
- Initial render < 500ms after SSR payload.
- Scroll smooth 60fps on 500 rows.
- URL state reflects filters + sort + view.

## Architecture
```
apps/web/src/app/(dashboard)/accounts/
├── page.tsx                 RSC fetch + pass initial data
├── accounts-table.tsx       TanStack + virtualizer
├── accounts-grid.tsx        card grid
├── view-toggle.tsx
├── filter-bar.tsx           group / status / synced / error
├── bulk-actions-bar.tsx     move group, set status, delete, refresh
├── search-input.tsx         debounced
├── columns.tsx              col defs
└── use-accounts-query.ts    client fetcher + filter state hook
```

## Related code files
- `apps/web/src/app/(dashboard)/accounts/page.tsx`
- `apps/web/src/app/(dashboard)/accounts/accounts-table.tsx`
- `apps/web/src/app/(dashboard)/accounts/accounts-grid.tsx`
- `apps/web/src/app/(dashboard)/accounts/filter-bar.tsx`
- `apps/web/src/app/(dashboard)/accounts/bulk-actions-bar.tsx`
- `apps/web/src/app/(dashboard)/accounts/search-input.tsx`
- `apps/web/src/app/(dashboard)/accounts/view-toggle.tsx`
- `apps/web/src/app/(dashboard)/accounts/columns.tsx`
- `apps/web/src/app/(dashboard)/accounts/use-accounts-query.ts`
- `apps/web/src/app/api/accounts/bulk/route.ts`
- `apps/web/src/server/accounts-list.ts`
- `apps/web/src/components/ui/status-badge.tsx`
- `apps/web/src/components/ui/group-badge.tsx`
- `apps/web/src/components/ui/sync-age-badge.tsx`

## Implementation Steps
1. Install `@tanstack/react-table`, `@tanstack/react-virtual`, `nuqs`, `date-fns` (vi locale).
2. Build server action `listAccounts({ filters, sort, cursor, limit })` in `server/accounts-list.ts`; returns `{ rows, nextCursor, total }`; scoped by RBAC (admin sees all; others filter by allowed groups).
3. RSC `accounts/page.tsx` reads `searchParams`, calls `listAccounts` with first page, renders client wrappers.
4. Define columns in `columns.tsx` with shadcn cell renderers; avatar cell shows `<img>` or fallback initials; status cell uses `<StatusBadge>`.
5. Implement `<AccountsTable>` (client component) using `useReactTable` + `useVirtualizer`; row height 48px; overscan 10.
6. Implement `<AccountsGrid>` as simple responsive grid of cards (`grid-cols-2 md:grid-cols-4 xl:grid-cols-6`).
7. Implement `<FilterBar>` with shadcn `MultiSelect`, `Select`, `Checkbox`; write to URL via `useQueryState` from nuqs.
8. Implement `<SearchInput>` with `useDeferredValue` + 300ms debounce; pushes `q` param.
9. Implement `<ViewToggle>` saving `accounts:view` in localStorage; initial server render uses default `table` to avoid hydration mismatch.
10. Implement selection state in TanStack; shift-click range via helper from docs.
11. `<BulkActionsBar>` appears when ≥1 selected: actions "Đổi nhóm", "Đổi trạng thái", "Xóa", "Làm mới", "Xóa ghi chú".
12. Each bulk action POSTs to `/api/accounts/bulk` with `{ action, ids, payload }`; server validates RBAC per id; emits audit entries per account.
13. Bulk refresh enqueues `sync-account` priority jobs; returns `jobIds[]`; UI shows toast "Đã đưa 12 tài khoản vào hàng đợi".
14. Add `<SyncAgeBadge>` coloring: green < 4h, yellow 4–24h, red > 24h; tooltip shows exact timestamp in vi locale.
15. Add empty state (when no accounts match filters) with CTA "Xóa bộ lọc" and "Nhập hàng loạt".
16. Add keyboard shortcuts: `/` focus search, `g p` → picker page, `g a` → accounts.
17. Accessibility: ensure table header roles, aria-sort, checkbox labels.
18. Implement Vietnamese date formatting via `format(date, 'HH:mm dd/MM', { locale: vi })`.
19. Add page-level error boundary + suspense skeleton (shadcn `Skeleton`).
20. Write Playwright e2e: filter by group → expect subset; bulk select 10 → bulk change status → expect updated.
21. Perf test: render 1 000 rows → measure scroll FPS via Chrome DevTools profile; target ≥ 55fps.
22. Add density toggle (comfy / compact) stored in localStorage; compact row height = 36px.

## Todo list
- [ ] Install TanStack Table + Virtual + nuqs
- [ ] listAccounts server action + RBAC
- [ ] page.tsx RSC
- [ ] columns.tsx
- [ ] AccountsTable (virtualized)
- [ ] AccountsGrid
- [ ] FilterBar (URL-synced)
- [ ] SearchInput debounced
- [ ] ViewToggle (localStorage)
- [ ] Selection + shift-range
- [ ] BulkActionsBar
- [ ] /api/accounts/bulk route + audit
- [ ] Bulk refresh → enqueue
- [ ] Sync age badge + group badge + status badge
- [ ] Empty state
- [ ] Keyboard shortcuts
- [ ] Vietnamese date formatting
- [ ] Skeleton + error boundary
- [ ] Playwright e2e + perf test
- [ ] Density toggle

## Success Criteria
- Table renders 500 rows smoothly (≥55fps scroll).
- Filters + sort + search round-trip via URL.
- Bulk action of 50 accounts completes < 3s.
- Switching table/grid preserves selection.
- Empty state + skeleton states look polished.

## Risk Assessment
- **Hydration mismatch w/ localStorage view** → default on server, set after mount.
- **Large DOM on grid** → virtualize grid too (`react-virtual` with row × col math) if > 1 000 accounts.
- **RBAC filter leakage** → unit test `listAccounts` with member user in allowed/disallowed group.

## Security Considerations
- Never return encrypted fields to table DTO; only metadata columns.
- Bulk refresh validates each id against RBAC; reject partial on any deny with clear message.
- Search on note uses ILIKE with param binding (no SQL injection).

## Next steps
Proceed to [Phase 07 — Audit Log / Polish / Deploy](./phase-07-audit-log-polish-deploy.md).
