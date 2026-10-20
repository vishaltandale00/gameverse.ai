# Mashup topology and focused editing

## Observed problem

The prior left guide combined the plan picker, every role, the selected role's source candidates, tuning, source execution and whole-system readiness in one scrolling column. The canvas repeated the same role descriptions in a fixed two-column grid. Dependency meaning was available only in hover titles. Moving cards therefore changed presentation without clarifying how the proposed system fit together.

Actual browser observation at 1280 × 720 found four traversal roles followed by more than thirteen detailed candidates. At 390 × 844 the old canvas was clipped and narrow role columns were hard to read. See `before/observations.md`; screenshots were inspected through the browser tool but were not saved to files.

## Design decision

Use hierarchy for selection and a graph for relationships:

- The goal bar selects the experience or source reconstruction.
- The map is the primary role selector. Compact nodes expose readiness and the chosen source module. The duplicate full role-card list is removed.
- The inspector contains Module, Connections and Gaps tabs, plus Configure only when an existing supported configuration actually exists. Chosen modules precede collapsed alternatives.
- Dashed edges come exclusively from declared plan dependencies. Visible numbered keys and incoming/outgoing descriptions make their meaning available without hovering. These are required/proposed relationships, not claims of working runtime integration.
- Connections exposes explicit plan state ownership and exact selected module identity. Shared module references do not imply that every referenced phase is implemented.
- Large maps and narrow screens use an explicitly labeled neighborhood. Shown/total counts, an all-role picker, relationship jumps and a Whole system toggle keep the larger structure reachable.

A strict tree would misrepresent feedback, multiple prerequisites and shared source state. The presentation helper condenses cycles only to assign layers; every role and declared edge remains present. It never generates runtime wiring, substitutes modules or mutates assembly state.

## Implementation boundary

`src/game-system-topology.js` is a pure projection/layout helper. `src/game-system-workspace.js` reorganizes presentation and keeps the existing assembly mutation callbacks. `workshop.css` supplies the responsive layout; `index.html` changes only the default Mashup introductory copy in this workstream. Existing dirty changes were retained. No dependency, CI stage or build step was added.

Positions are cached per plan and visible role set. This fixes the reviewed failure in which independently laid-out neighborhoods reused global role coordinates and overlapped after navigation. Scope changes refit the view; role changes reset only inspector scrolling. Source mechanics and raw binding controls remain available through the advanced inspector.

## Verification and measurement limits

The six topology tests cover branching/fan-in, cycles/self-links, disconnected/empty plans, invalid references, scoped visibility, and exact shared module identity. The combined topology and selection-request checks passed 8/8 in 33.655 ms of Node test-runner time; the six-test focused helper run took 0.05 s process wall time. Environment: Node v24.14.0, Darwin arm64, source commit 85e2139 with pre-existing uncommitted work. No queue duration applies to these direct local checks. No build or CI run was added or measured.

The local server reads these frontend files directly. A static export rebuild is not necessary for the served `/v0?view=workshop` route. Before/after browser observations use representative tasks and comparable viewport sizes; they do not establish a measured human task-time improvement. See `after/verification.md` for actual browser outcomes and remaining limitations.

Browser verification exposed a pre-existing legacy MZM prefab admission failure after reviewed package identity changes. The backend owner preserved the old assembly, created a versioned compatibility graph with current reviewed identity/pose-frame references, and changed the existing route's graph reference. The verified project server was restarted on the same local address. A fresh browser run then added the legacy prefab, applied HP 20 / damage 5 / two later eligible updates and ran the actual source core: HP 20 → 15, with reaction 17 → 16 → 15. No new gameplay scope or configuration meaning was introduced by the UI change.
