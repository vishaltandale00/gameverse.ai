# Kernel request: composition declarations and adapters (from v2/planner/compose-check.js)

The static composition checker (`v2/planner/compose-check.js`, `node v2/tools/composition-matrix.mjs`) decides
from cards alone whether primitives compose on a space. Two kernel-side follow-ups would make preflight agree
with it. The first is implemented.

1. **Adapters in preflight.** *Done:* `preflight` adds a fitting adapter's `adapts.provides` capabilities and services to its bound space, and a sub-space adapter instance (`card.adapts.subspace`, e.g. `engine.adapt.projection`) defines a region space of its id with the projected kind's capabilities. Original request: A card may declare `card.adapts = { provides: { capabilities?, content?, services? },
   from: { spaces?, capabilities? }, projection }`. The checker counts `adapts.provides.capabilities` as provided
   on the space an adapter instance is bound to (when the space matches `from`). `preflight` in
   `kernel/document.js` builds `spaceCaps` from space cards only, so a document that composes through an adapter
   still fails `capability_missing`. Request: after `spaceCaps` is built, add each used adapter's
   `adapts.provides.capabilities` to its bound space when `from` matches, and its `adapts.provides.services` to
   `ctx.provides.services`. Workaround until then: an adapter can only provide content and services (which
   preflight does not check per space), not capabilities, in a document that must preflight.

2. **Content declarations in KERNEL_API.md §1.** Document the fields the checker reads: space
   `card.needs.content` (and optional `card.provides.content`), generator `card.spaces` and
   `card.provides.content`, any card's optional `card.needs.content`, and `card.adapts`. Types are already in
   `kernel/types.d.ts` (`Card.needs`, `Card.spaces`, `Provides.content`, `Adapts`).
