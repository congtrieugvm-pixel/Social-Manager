# Phase 03 — Consolidate Reach Workspace

## Context links
- Plan: [plan.md](plan.md)
- Depends on: Phase 02 (shared components)

## Overview
- **Date**: 2026-04-20
- **Description**: Move `/insights/reach` → `/fanpage/reach` and absorb `/insights` (Posts) + `/insights/overview` (Σ table). Single URL with 3 views switched by `?view=reach|posts|overview`.
- **Priority**: P0
- **Status**: Todo

## Key insights
- Current `/insights/reach` is already the strongest Reach UI — build on it, don't rewrite.
- Posts feature in `/insights` uses `/api/fanpages/:id/posts` + `/api/posts/:id/insights` + `/api/posts/insights/batch`. These stay.
- `/insights/overview` uses a **unique** `/api/insights/overview` endpoint — must keep.
- Keep fanpage selection + range in **shared page state** so switching views doesn't lose context (that is the whole reason for a single page vs. three separate pages).
- Views rendered lazily with dynamic `import()` or simple conditional render — at this scale (a few hundred rows max) conditional is fine.

## Requirements
1. New route `app/src/app/fanpage/reach/page.tsx`.
2. URL controls: `?ids=1,2,3&view=reach&days=30` (or `from=…&to=…`). Reflect selection/view/range in URL via `useRouter().replace` + `useSearchParams` so refresh preserves state.
3. View switcher: 3 pills at top-right. Default `view=reach` if absent.
4. Reach view: existing KPI cards, chart, breakdown, window-mismatch banner — unchanged.
5. Posts view: per-fanpage posts table (or aggregated across selected fanpages — see open question below). Actions: `fetchReachOne(postId)`, `fetchReachAll(fanpageIds)`.
6. Overview view: Σ KPI strip (8 tiles) + sortable overview table from `/api/insights/overview`. Honors the selector (filter overview rows by selected ids).
7. All 3 views share the sync-insights button and fanpage selector.

## Architecture
```
/fanpage/reach
├── <PageHeader>  eyebrow "Facebook · Reach" + H1 "Reach & Insight"
├── <Toolbar>
│     <FanpageSelector ids onChange />
│     <GroupFilterChips />
│     <RangeSelector days|from|to />
│     <SyncInsightsButton ids range />
│     <ViewSwitcher value={view} onChange />
├── {view === 'reach'}    → <ReachView snapshots={…} />
├── {view === 'posts'}    → <PostsView fanpageIds={…} />
└── {view === 'overview'} → <OverviewView filterIds={…} />
```

File layout (kept inside `fanpage/reach/` to avoid polluting `_components/` with page-specific chunks):
```
app/src/app/fanpage/reach/
  page.tsx                   ← shell, URL sync, shared state
  _views/reach-view.tsx      ← KPI + chart + breakdown (ported from /insights/reach)
  _views/posts-view.tsx      ← posts table (ported from /insights)
  _views/overview-view.tsx   ← Σ strip + overview table (ported from /insights/overview)
  _views/range-selector.tsx  ← 7/30/90/custom (ported)
  _views/chart-canvas.tsx    ← SVG renderer (moved from /insights/reach)
```

## Related files
- Copy from: `app/src/app/insights/reach/page.tsx` (lines 80–1177: ReachDashboard, ChartCanvas, DeltaBadge, etc.)
- Copy from: `app/src/app/insights/page.tsx` (lines 404, 438, 478, 531 for sync/fetch functions; lines 1060–1210 for posts table render)
- Copy from: `app/src/app/insights/overview/page.tsx` (full file — Σ strip + overview table)
- APIs: `/api/fanpages/snapshots`, `/api/fanpages/insights/batch`, `/api/fanpages/:id/posts`, `/api/posts/:id/insights`, `/api/posts/insights/batch`, `/api/insights/overview`

## Implementation steps
1. Scaffold `app/src/app/fanpage/reach/page.tsx` as a client component that syncs `selectedIds`, `view`, `rangeMode`, `customFrom`, `customTo` to URL.
2. Move the reach-view body from `/insights/reach/page.tsx` into `_views/reach-view.tsx`. Keep logic; accept `ids` + `range` as props. Replace local components with shared ones from Phase 02.
3. Build `_views/posts-view.tsx`. Port `syncPosts`, `fetchReachAll`, `fetchReachOne` + posts table. Show posts from all selected fanpages (flatten). If none selected, prompt "Chọn fanpage trước".
4. Build `_views/overview-view.tsx`. Port `/api/insights/overview` fetch + Σ strip + sortable table. Apply `selectedIds` filter client-side (or pass to route if/when supported — currently route returns all, filter in-memory is fine).
5. Build `_views/range-selector.tsx`. Port from `/insights/reach` (7/30/90 pills + custom date range).
6. Wire the view switcher: `?view=reach` default. Switching persists selector/range.
7. Verify snapshot window-mismatch banner still fires correctly after refactor (unit-test the predicate if trivial; otherwise manual).
8. Typecheck. Manual smoke test: each view, selector change, range change, URL refresh, deep link like `/fanpage/reach?ids=1,2&view=posts`.
9. **Do NOT delete** old routes yet. Phase 4 does redirects + deletes.

## Todo list
- [ ] Scaffold `/fanpage/reach/page.tsx` with URL sync
- [ ] Extract `_views/reach-view.tsx`
- [ ] Port Posts feature to `_views/posts-view.tsx`
- [ ] Port Overview feature to `_views/overview-view.tsx`
- [ ] `_views/range-selector.tsx`
- [ ] `_views/chart-canvas.tsx` moved
- [ ] View switcher with URL state
- [ ] Window-mismatch banner works
- [ ] Typecheck green
- [ ] Smoke test all 3 views + deep link

## Success criteria
- `/fanpage/reach?view=reach|posts|overview` fully replaces `/insights`, `/insights/reach`, `/insights/overview` feature-wise.
- Switching view does not reload fanpage selection or range.
- Deep-linking via URL works on refresh.
- No duplicated format/chip/selector code (all via Phase 02 extractions).

## Risk assessment
- **Medium**. Largest surface area. Risks:
  - Subtle regression in snapshot-range logic (window-mismatch banner). Mitigation: keep predicate intact, visual-diff test.
  - Posts table performs poorly with many selected fanpages. Mitigation: cap default to top N or paginate; only hit `fanpage/:id/posts` on-demand per fanpage group.
  - `/api/insights/overview` may not support `ids` filter — confirm by reading route before filtering client-side.

## Security considerations
None — no new endpoints, no new data exposure.

## Next steps
Phase 4 — cleanup + redirects.
