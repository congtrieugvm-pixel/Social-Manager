# Current State Audit — Quản Lý Fanpage

**Date**: 2026-04-20
**Scope**: 6 pages under "Quản Lý Fanpage" sidebar group + shared API surface.

---

## Page-by-page inventory

### 1. `/fanpage` — Danh sách fanpage (1151 LOC)
**Role**: Primary workspace. Recently redesigned grid/table with 12 columns (STT, avatar, nhóm, followers, likes, reach 28d, impressions, video views, chủ, sync, actions).
**Unique features**:
- Bulk assign group (`/api/insight-groups`) — `GroupChips`, `GroupManagerModal`
- Inline group CRUD modal (`GroupManagerModal`, `GroupRow` — lines 1727, 1881)
- `GrowthChart` sparkline per-fanpage preview (line 1332)
- Filter chips, sortable headers (`SortableTh` — line 1105)
- Sync-from-FB trigger (pull fresh pages from connected FB accounts)

**Verdict**: **Keep as anchor**. Already the cleanest page.

---

### 2. `/fanpage-groups` — Nhóm fanpage (329 LOC)
**Role**: Standalone CRUD for `insight_groups`.
**Unique features**: Name, color, ordering.
**Overlap**: Functionality already embedded in `/fanpage` via `GroupManagerModal`.
**Verdict**: **Deprecate** — merge into `/fanpage` modal (already present) or inline panel.

---

### 3. `/fanpage/manage` — Bảng quản lý (833 LOC)
**Role**: Legacy bulk-actions table.
**Columns**: #, Fanpage, Category, Likes, Followers, Token, Insights, Sync, Chủ, Hành động.
**Unique features** vs `/fanpage`:
- Bulk **reassign owner fb account** (PATCH `fbAccountId`) — NOT in `/fanpage`
- Bulk delete — NOT in `/fanpage`
- Batch insights trigger with per-row results panel

**Overlap**: ~80% of columns/filters duplicate `/fanpage`.
**Verdict**: **Deprecate the page; port bulk-reassign + bulk-delete** into `/fanpage` toolbar. The batch-results panel is a nice affordance — merge into `/fanpage` too.

---

### 4. `/insights` — Insight tổng quan (1934 LOC)
**Role**: Kitchen-sink page. Mixes:
- Fanpage selector (multi-select)
- Page-level insights sync (`syncPageInsights` → `/api/fanpages/insights/batch`)
- Posts list fetch & table (`syncPosts`, column "Bài viết", line 1083)
- Per-post reach sync (`fetchReachOne`, `fetchReachAll`)
- Aggregated chart & KPI cards
- Group chips, group manager modal (redundant with `/fanpage`)

**Unique features**: Posts table with per-row reach button.
**Overlap**: Sync buttons duplicate `/insights/reach`; selector/chips duplicate `/fanpage`.
**Verdict**: **Dissolve**. Move Posts feature into the new Reach workspace; drop everything else.

---

### 5. `/insights/reach` — Reach Dashboard (1177 LOC)
**Role**: Time-range reach analytics. 5 KPI cards, chart, breakdown panel, range selector (7/30/90/custom + from/to).
**Unique features**:
- `rangeMode` with `days` **or** `from`/`to` → querystring `/api/fanpages/snapshots?...`
- Snapshot window-mismatch detection (re-sync prompt, line 302)
- `DeltaBadge`, `ChartCanvas` SVG renderer, `FilterChip` component
- Fetches via `/api/fanpages/insights/batch` with `{ ids, days|from|to }` body

**Verdict**: **Keep as Reach anchor**. Absorb `/insights` Posts feature and `/insights/overview` totals.

---

### 6. `/insights/overview` — Bảng quản lý Insight tổng (672 LOC)
**Role**: Cross-fanpage aggregator table.
**Unique features**:
- Hits `/api/insights/overview` (bespoke route returning `OverviewRow[]` with per-fanpage rolled-up totals: `totalReach`, `totalImpressions`, `totalEngaged`, `fanDelta7d`, `postCount`, `postsWithReach`)
- Σ summary strip: Likes, Followers, ΔLikes 7d, Reach trang 28d, Reach posts, Impressions, Engaged, Posts
- Sortable by each aggregate column
- `syncAllPostReach` — per-fanpage loop hitting `/api/posts/insights/batch`

**Overlap**: KPI strip duplicates `/insights/reach`'s totals but computed differently (all fanpages vs selected subset). Table overlaps `/fanpage` columns.
**Verdict**: **Merge into Reach** as a "Bảng tổng" view/tab. The `/api/insights/overview` route is valuable — keep; it's the only source of `postsWithReach` & `fanDelta7d` rolled-up across all pages.

---

## Shared / duplicated code

| Component | Present in | Extract to |
|---|---|---|
| FanpageSelector (multi-select) | /insights, /insights/reach | `_components/fanpage-selector.tsx` |
| GroupFilterChips | /fanpage, /insights, /insights/overview | `_components/group-filter-chips.tsx` |
| SyncInsightsButton | /fanpage/manage, /insights, /insights/reach, /insights/overview | `_components/sync-insights-button.tsx` (thin wrapper around `/api/fanpages/insights/batch`) |
| fmtNum / fmtTime / fmtDelta | all 6 pages | `_lib/format.ts` |
| Kv (KPI card) | /insights/reach, /insights/overview | `_components/kv-card.tsx` |
| Chip / FilterChip | /fanpage, /insights, /insights/reach, /insights/overview | `_components/filter-chip.tsx` |

**DRY caveat**: Only extract when a component is used in 2+ consolidated pages after restructure — avoid premature abstraction for pieces that will live in a single file post-merge.

---

## API surface (post-consolidation targets)

All routes to **keep as-is** (no backend changes required for IA work):
- `/api/fanpages` (list + sync-from-FB)
- `/api/fanpages/:id` (GET/PATCH/DELETE)
- `/api/fanpages/:id/posts` (per-fanpage posts list)
- `/api/fanpages/:id/insights` (per-fanpage insight fetch)
- `/api/fanpages/insights/batch` (batch insight sync)
- `/api/fanpages/snapshots` (range-aware snapshots)
- `/api/fanpages/sync` (pull pages from FB accounts)
- `/api/posts/:id/insights` (per-post reach)
- `/api/posts/insights/batch` (batch per-fanpage post reach)
- `/api/insights/overview` (aggregated roll-up — **unique** data source for "Bảng tổng" view)
- `/api/insight-groups` + `/api/insight-groups/:id` (group CRUD)

---

## Data preservation (non-negotiable)

DB tables `fanpages`, `fanpage_snapshots`, `fanpage_posts`, `insight_groups` remain untouched. All historical snapshots (with `range_start`/`range_end`) keep working with the Reach page's existing window-mismatch detection.
