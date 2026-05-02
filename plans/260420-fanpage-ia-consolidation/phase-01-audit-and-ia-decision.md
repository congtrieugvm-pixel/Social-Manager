# Phase 01 — Audit & IA Decision

## Context links
- Plan: [plan.md](plan.md)
- Audit: [reports/01-current-state-audit.md](reports/01-current-state-audit.md)
- Sidebar: `app/src/app/_components/sidebar.tsx`

## Overview
- **Date**: 2026-04-20
- **Description**: Audit 6 existing pages, identify unique vs. duplicate features, lock IA. Produces an approved blueprint for Phases 2–5.
- **Priority**: P0 (blocks everything)
- **Status**: Done (audit complete; Option B chosen)

## Key insights
- `/fanpage` is already the strongest UI — anchor it.
- `/fanpage/manage` only carries **bulk reassign fbAccountId** + **bulk delete** + **batch result panel** as genuinely-unique value.
- `/insights/overview` is backed by a unique API route `/api/insights/overview` returning `postsWithReach`, `fanDelta7d`, and cross-fanpage rolled-up totals. That data is worth preserving as a "Bảng tổng" view inside Reach.
- `/insights` posts table + `fetchReachOne`/`fetchReachAll` naturally belong on the Reach page (user already requested).
- `/fanpage-groups` has zero unique features — `GroupManagerModal` in `/fanpage` already covers CRUD.

## Requirements
1. Final IA: **Option B** — 2 sidebar sub-items, query-param sub-views in Reach.
2. Every deprecated URL must 308-redirect to its successor with deep-link preserved where possible (e.g. `/insights/reach?ids=1,2` → still works after rename).
3. No DB migrations. No API route changes.

## Architecture
```
/fanpage              (Danh sách fanpage)
  toolbar: [ Sync from FB ] [ Bulk reassign ] [ Bulk delete ] [ Group manager ]
  filter chips (groups) · search · sortable columns
  inline GroupManagerModal (existing)

/fanpage/reach        (Reach & Insight)
  header: fanpage selector (shared) · group chips (shared) · range selector
  view=reach     → KPI cards · chart · breakdown · snapshot-mismatch banner
  view=posts     → posts table · per-post reach · bulk reach
  view=overview  → Σ KPI strip · overview table (/api/insights/overview)
```

## Related files (read-only reference)
- `app/src/app/fanpage/page.tsx` (anchor)
- `app/src/app/fanpage/manage/page.tsx` (source of bulk-reassign/delete)
- `app/src/app/fanpage-groups/page.tsx` (to deprecate)
- `app/src/app/insights/page.tsx` (Posts feature source)
- `app/src/app/insights/reach/page.tsx` (anchor for Reach)
- `app/src/app/insights/overview/page.tsx` (Overview data source user)
- `app/src/app/_components/sidebar.tsx`

## Implementation steps
1. Confirm IA decision with user via plan.md open questions.
2. Freeze scope — no new features in this consolidation.
3. Hand off to Phase 2.

## Todo list
- [x] Read ambiguous pages
- [x] Write audit report
- [x] Commit to Option B
- [ ] Get user sign-off on 3 unresolved questions in plan.md

## Success criteria
- Audit report committed.
- IA decision has written rationale.
- Unresolved questions documented.

## Risk assessment
- **Low**. Audit-only phase. Risk is unclear ownership of `/insights/overview` features → mitigated by explicit question #3 in plan.md.

## Security considerations
None — no code changes.

## Next steps
Proceed to Phase 2 once user confirms questions 1 & 2 (question 3 only blocks Phase 3).
