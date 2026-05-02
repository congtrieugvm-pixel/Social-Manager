# Fanpage IA Consolidation

**Date**: 2026-04-20
**Scope**: Merge 6 pages under "Quản Lý Fanpage" into 2 clean workspaces. No backend changes.
**Audit**: [reports/01-current-state-audit.md](reports/01-current-state-audit.md)

## Problem

6 pages, heavy overlap. Posts feature sits on wrong page. Two "bảng" pages (`/fanpage/manage`, `/insights/overview`) duplicate `/fanpage` + `/insights/reach` with only fragments of unique value. Sync buttons scattered; selector/chip code copy-pasted 3 times.

## IA Decision — **Option B (Flat restructure)**

```
Quản Lý Fanpage
├── Danh sách fanpage          → /fanpage          (absorbs /fanpage/manage, /fanpage-groups)
└── Reach & Insight            → /fanpage/reach    (absorbs /insights, /insights/reach, /insights/overview)
      └─ sub-views via ?view=  reach | posts | overview  (URL-shareable, lazy-rendered)
```

**Rationale** (YAGNI/KISS/DRY):
- 2 sidebar links beat 5 — matches the 2 actual jobs (manage catalog vs. read metrics).
- `?view=` query params give deep links without nested routes or tab-state gymnastics.
- Code splits along a real seam: data entry/ownership (pages, groups, owners) vs. analytics (snapshots, posts, reach).
- Option A (single mega-page with tabs) was rejected: 3000+ LOC monolith, worse git diffs, shared selection state is an imagined need at 2-user scale.
- Option C (hybrid 2-level tabs) rejected: more URL state, no added value over B.

## Phases

| # | Phase | Status | File |
|---|---|---|---|
| 1 | Audit + finalize IA + deprecation paths | `[██████████] 100%` done | [phase-01-audit-and-ia-decision.md](phase-01-audit-and-ia-decision.md) |
| 2 | Extract shared components (`_components/`, `_lib/format.ts`) | `[░░░░░░░░░░] 0%` todo | [phase-02-shared-components.md](phase-02-shared-components.md) |
| 3 | Consolidate Reach workspace (`/fanpage/reach` with 3 views) | `[░░░░░░░░░░] 0%` todo | [phase-03-consolidate-reach.md](phase-03-consolidate-reach.md) |
| 4 | Absorb bulk actions into `/fanpage`; delete deprecated routes + redirects | `[░░░░░░░░░░] 0%` todo | [phase-04-cleanup-and-redirects.md](phase-04-cleanup-and-redirects.md) |
| 5 | Optional: inline group management in `/fanpage` side panel | `[░░░░░░░░░░] 0%` optional | [phase-05-inline-groups.md](phase-05-inline-groups.md) |

## Constraints

- Next 16.2.4 App Router — consult `node_modules/next/dist/docs/` before any Next API use.
- UI Tiếng Việt, comments English. Serif headings, Mono badges.
- DB untouched. Historical snapshots must keep working under Reach window-mismatch logic.
- 2 users, a few hundred fanpages, desktop-only.

## Success (plan-wide)

- Sidebar "Quản Lý Fanpage" shows exactly 2 sub-items.
- `/fanpage/manage`, `/fanpage-groups`, `/insights`, `/insights/overview` return **308 redirect** to their successors (deep links survive).
- Zero duplicated formatter/selector/chip code across remaining pages.
- Every feature previously reachable is still reachable (bulk reassign, per-post reach, Σ overview, etc.).

## Unresolved questions (for user)

1. **`/fanpage/manage`**: xoá hẳn hay giữ làm "Bulk edit mode" toggle trong `/fanpage`? Plan assumes absorb-and-delete (Phase 4). If you want a dedicated "bulk mode" UI (checkbox column hidden by default, revealed by a toggle), say so before Phase 4.
2. **Nhóm fanpage**: inline panel trong `/fanpage` (Phase 5) hay giữ modal `GroupManagerModal` hiện tại? Plan marks Phase 5 as optional — skip if modal is fine.
3. **`/insights/overview`**: ngoài 8 Σ KPI và cột `postsWithReach`/`fanDelta7d`, bạn có dùng feature/cột nào nữa mà chưa có ở `/insights/reach` không? Nếu có, liệt kê trước Phase 3 để không mất.
