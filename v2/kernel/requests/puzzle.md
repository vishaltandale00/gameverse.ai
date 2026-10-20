# Kernel requests from the puzzle workstream

Each request has the workaround the puzzle primitives (falling.pieces, match, slide.merge, paddle, launcher, destructible, creature.*, encounter, lanes.periodic) use today.

## 1. A sub-rectangle `settle`

`engine.space.grid` settle(rt, {dir, layer, by}) settles the whole space and treats only rule-`fixed` blocks as fixed. Puzzle boards sit anywhere in a space (`board.at/size/axes/fall`), hold tag-fixed cells (viruses: `red/virus/fixed`, blockers) and linked capsule halves (`link:l|r|u|d`), and may have holes.

- **Workaround:** `puzzle-lib-board.js settleBoard` calls the grid's settle only when the board is the whole space, falls vertically, has no holes and holds no tag-fixed or linked cells. Otherwise it runs column gravity in memory and writes the differences with setCell.
- **Request:** add a shared `settle` capability signature: `settle(rt, {box?, dir, layer?, fixed?(block) → bool, bonds?(at) → partner, by})`, returning `[{from, to, block}]`.

## 2. `reachable` with assumed cells

The falling-pieces guard needs to know whether landing cells would cut the player off before writing them.

- **Workaround:** a board-local 4-neighbour flood fill, the same one the old falling mod used. It ignores movement abilities.
- **Request:** `reachable(from, rt, {assumeSolid: [cells], abilities})`, so the guard can use the space's ability-aware reachability without trial edits that pollute the edit log.

## 3. A score owner

Puzzle primitives award points through `add_score {amount, reason}` when an effect of that name is registered. Otherwise they add to var `score` and emit `score {amount, reason}`.

- **Request:** freeze the `add_score` field names (`amount`, `reason`) in the catalog once `gameplay.score` lands.

## 4. Self-moving bodies in spaces without dynamics

paddle, launcher and (indirectly) destructible support `motion: 'self'`: they integrate their own bodies with `gravityAt` and `slide`, and emit `contact` events shaped like physics2d's, so breakouts and slingshots run on tile and grid spaces too.

- **Request:** bless this as the convention: a primitive that moves bodies in a space without `dynamics` emits `contact` with the physics2d fields. Alternatively, provide a kernel helper for it.

## 5. Typed events with numeric subjects

`lines_cleared:<n>` and `merged:<value>` use numbers as typed subjects. That works today because event names are strings.

- **Request:** state in KERNEL_API §5 that subjects may be numbers, and that they are stringified in the qualified name.
