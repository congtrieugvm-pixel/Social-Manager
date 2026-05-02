# Phase 05 — Inline Group Panel in `/fanpage` (Optional)

## Context links
- Plan: [plan.md](plan.md)
- Depends on: Phase 04

## Overview
- **Date**: 2026-04-20
- **Description**: Replace `GroupManagerModal` in `/fanpage` with a slide-in right panel or always-on sidebar column. CRUD groups without leaving the list view.
- **Priority**: P2 (optional — only if user answers Q2 in plan.md with "inline please")
- **Status**: Optional / deferred

## Key insights
- Current modal works; KISS says leave it alone unless there is a concrete UX complaint.
- If we do inline it, a right-side slide-over is less disruptive than a permanent column (desktop viewports vary).
- `/api/insight-groups` + `/api/insight-groups/:id` unchanged.

## Requirements
1. Toggle button "Nhóm" in `/fanpage` toolbar opens the panel.
2. Panel: list of groups (name, color, count, edit/delete). Add-new form at bottom.
3. Drag-to-reorder optional (out of scope unless explicit ask).
4. Closing the panel does not lose list selection or filter state.

## Architecture
```
/fanpage/page.tsx
  ├── Toolbar ··· [ Nhóm ▸ ]   ← toggles panel
  └── <GroupPanel open={…} onClose={…} />
       ├── list<GroupRow /> (edit inline, delete confirm)
       └── <AddGroupForm />
```

File:
```
app/src/app/fanpage/_components/group-panel.tsx
```

## Related files
- `app/src/app/fanpage/page.tsx` — `GroupManagerModal` (line 1727), `GroupRow` (line 1881)
- `app/src/app/fanpage-groups/page.tsx` — reference for CRUD flow (already to be deleted in Phase 4)
- APIs: `/api/insight-groups`, `/api/insight-groups/:id`

## Implementation steps
1. Extract `GroupManagerModal` body into `group-panel.tsx`.
2. Replace modal wrapper with a slide-over (right-side `<aside>` with `transform: translateX`). Backdrop click or Esc closes.
3. Delete the modal definitions from `fanpage/page.tsx`.
4. Typecheck + manual test.

## Todo list
- [ ] Extract `group-panel.tsx`
- [ ] Slide-over styling (CSS transition)
- [ ] Toggle button wired
- [ ] Keyboard Esc close
- [ ] Modal removed from page.tsx
- [ ] Typecheck green

## Success criteria
- Groups CRUD works from `/fanpage` without modal overlay.
- No regression in list selection/filter when opening/closing panel.

## Risk assessment
- **Low**. Pure UI refactor.

## Security considerations
None.

## Next steps
Close out IA consolidation. Future work (out of scope): global search across fanpages, saved filter presets, scheduled sync UI.
