# Gameverse v2: any idea to the game asked for

v2 turns a player's idea, including mashups, into a playable game built from composable primitives.

- **Specification:** [ARCHITECTURE.md](ARCHITECTURE.md). The non-negotiables (§1), the generation flow (§5),
  verification (§6) and the delivery rules (§7) are binding.
- **Where the code stands and what is required next:** [HANDOFF.md](HANDOFF.md).
- **Kernel contract and primitive rules:** [KERNEL_API.md](KERNEL_API.md).
- **Primitive catalogue (generated from the cards):** [PRIMITIVE_CATALOG.md](PRIMITIVE_CATALOG.md).
- **Default polish every game gets:** [POLISH.md](POLISH.md).
- **Rules for agents working here:** [../CLAUDE.md](../CLAUDE.md).

Run the studio:

```bash
npm ci --ignore-scripts
V2_GAPS=auto PORT=4181 node scripts/serve.mjs
```

then open `http://localhost:4181/v2`.

Checks: `npm run typecheck` and the focused test files under `tests/v2-*.test.js` for the area you change.

`v2/engine`, `v2/modules` and `v2/kits` are earlier generations kept as reference material; they are not part of
the live path.
