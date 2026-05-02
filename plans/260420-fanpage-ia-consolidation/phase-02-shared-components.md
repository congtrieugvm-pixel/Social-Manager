# Phase 02 — Shared Components & Format Helpers

## Context links
- Plan: [plan.md](plan.md)
- Depends on: Phase 01 (IA locked)

## Overview
- **Date**: 2026-04-20
- **Description**: Extract the components and helpers that will be used by 2+ consolidated pages. No UI/UX change visible to user.
- **Priority**: P1 (prerequisite for Phase 3 & 4 clean diffs)
- **Status**: Todo

## Key insights
- Only extract when a piece is used in **2+ surviving pages** post-restructure. Extracting things that will live entirely inside one file (e.g. `GrowthChart`) is premature.
- Keep extractions flat — one file per component under `app/src/app/_components/`. No barrel files.
- Formatters are tiny; group in `app/src/app/_lib/format.ts`.

## Requirements
1. No behavioral change. Extracted components must produce byte-identical DOM where sensible.
2. Callers import via relative path (`@/app/_components/...` if tsconfig alias exists, else relative).
3. TypeScript strict — component props explicit, no `any`.

## Architecture
```
app/src/app/_components/
  fanpage-selector.tsx        ← multi-select, driven by /api/fanpages
  group-filter-chips.tsx      ← chip strip, takes groups + active id + onChange
  sync-insights-button.tsx    ← thin button → /api/fanpages/insights/batch
  kv-card.tsx                 ← KPI tile (label + value + optional color)
  filter-chip.tsx             ← generic active/inactive pill

app/src/app/_lib/
  format.ts                   ← fmtNum, fmtFullNum, fmtTime, fmtDate, fmtDelta, todayISO, daysAgoISO
```

## Related files
- Source refs (existing implementations to consolidate):
  - `app/src/app/fanpage/page.tsx` — `GroupChips` (line 1251), `Chip` (line 1298)
  - `app/src/app/insights/reach/page.tsx` — `FilterChip` (line 953), `DeltaBadge` (line 996), `fmtNum`/`fmtFullNum`/`fmtDate` (lines 56–73)
  - `app/src/app/insights/overview/page.tsx` — `Kv`, `Chip`, `TH`, `fmtNum`/`fmtTime`/`fmtDelta` (lines 56–74)
  - `app/src/app/fanpage/manage/page.tsx` — `formatNumber`/`formatTime` (lines 46–59)

## Implementation steps
1. Create `_lib/format.ts` with the 7 helpers; update the 3 surviving callers (/fanpage, /insights/reach, /insights/overview-soon-merged) in their **current** locations to import from it. Remove local copies. Run typecheck.
2. Create `_components/filter-chip.tsx` — merge the best API from existing `Chip`/`FilterChip` variants (props: `active`, `onClick`, `label`, `color?`).
3. Create `_components/group-filter-chips.tsx` — consumes an array of `{id, name, color, count}` + `"all"|"unassigned"|number` value + onChange.
4. Create `_components/fanpage-selector.tsx` — multi-select list with search; emits `number[]`. Used by Reach page.
5. Create `_components/sync-insights-button.tsx` — accepts `ids: number[]` + optional `range: {days?; from?; to?}`; renders button + result message; emits `onDone(result)`.
6. Create `_components/kv-card.tsx` — `label`, `value`, optional `color`, optional `delta`.
7. Swap existing `/fanpage`, `/insights/reach` usages to the new components one at a time. Leave `/insights`, `/insights/overview`, `/fanpage/manage`, `/fanpage-groups` untouched (they will be deleted in later phases).
8. Typecheck + smoke-test each page after each swap.

## Todo list
- [ ] `_lib/format.ts` created + callers migrated
- [ ] `_components/filter-chip.tsx`
- [ ] `_components/group-filter-chips.tsx`
- [ ] `_components/fanpage-selector.tsx`
- [ ] `_components/sync-insights-button.tsx`
- [ ] `_components/kv-card.tsx`
- [ ] `/fanpage` migrated to new components
- [ ] `/insights/reach` migrated to new components
- [ ] Typecheck green
- [ ] Manual smoke-test: chip filter, selector, KPI cards, sync button

## Success criteria
- New files exist; pages render identically.
- No duplicated formatter implementation remains in surviving pages.
- `tsc --noEmit` passes.

## Risk assessment
- **Low–medium**. Extraction mistakes (bad prop typing, missing edge case in chip's color handling). Mitigation: migrate one page at a time, diff the rendered output visually.

## Security considerations
None.

## Next steps
Phase 3 — use these components to build `/fanpage/reach` as the Reach workspace.
