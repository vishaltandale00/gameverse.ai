# v2 handoff, 2026-10-20 (evening)

Read this first, then `v2/ARCHITECTURE.md` and `v2/PRIMITIVE_CATALOG.md`.

## The main point: return to the architecture

**`v2/ARCHITECTURE.md` is the plan and must be followed.** Its design:
- one space-agnostic kernel (`v2/kernel/`);
- primitives as the only unit of extension (four families: engine, plot, graphics, gameplay), each with a card, params, capabilities and install/render hooks;
- a game is a document of primitives (`gameverse.v2.game/0.2`);
- layered generation (outline, then first playable, then detail, then gap-filling with new primitives);
- verification by plot solver, spatial checks and headless playtest.

`v2/PRIMITIVE_CATALOG.md` already specifies the primitives, the capability interfaces, the content schemas, a coverage matrix across 55 games and a P0 build list (§10).

**This session strayed from that plan.** It built monolithic per-genre "kits" (`v2/kits/*`), then patched gaps with kit-level mods, look presets and scenery features. The user rejected this firmly:
- they need one truly modular framework where any idea, including any mashup, composes from shared primitives;
- they don't want one engine per genre or one-off pieces;
- example requests ("Dark Souls Pokémon", "Call of Duty × Minecraft") are illustrations of the scope, never the requirements.

The next agent should:
1. Build out `v2/kernel` and the catalog's primitives across all families, against the coverage matrix. Distribute the work across parallel subagents by family, against a stable, written kernel API.
2. Build the ARCHITECTURE §4 generation pipeline:
   - decompose an idea into the mechanics of every game it references;
   - map those to primitives;
   - compose and preflight a document;
   - publish a first playable, then detail;
   - fill gaps by generating new primitives (experiments), promoted to tested primitives.
3. Decompose the existing kits into primitives and catalog entries so their depth carries over. Kits may survive only as presets (documents), not as engines.

## Where things are

- **Branch:** `claude/handoff-continuation-d50036`, worktree `/Users/shishirtandale/Projects/gameverse.ai/.claude/worktrees/handoff-continuation-d50036`. Local; not pushed since PR #28/#29 were refreshed.
- **PRs (stacked, open):** all of them are far behind the branch.
  - [#28](https://github.com/vishaltandale00/gameverse.ai/pull/28): v2 into main.
  - [#29](https://github.com/vishaltandale00/gameverse.ai/pull/29): overworld venues, for Vishal.
  - [#30](https://github.com/vishaltandale00/gameverse.ai/pull/30): maze kit.
- **Run:** `PORT=4181 node scripts/serve.mjs`, then `/v2` (studio). `.claude/launch.json` has a `gameverse-v2` entry. Restart the server after any change to `v2/art`, `v2/planner` or `v2/kits`: it caches modules, and stale servers caused several bad results.
- **Tests:** `node --test tests/*.test.js`, about 600 tests, passing when the machine is idle. Other repositories on this machine run heavy test suites, with load averages of 20–60, and a few wall-clock-sensitive verify tests flake under that load.
- **Qualification** (paid model calls, run separately): `node v2/tools/kit-qualify.mjs --kit <id> --n 3`.
- **Credentials:** `OPENAI_API_KEY` is in the main checkout's `.env.local` and loaded by `loadOpenAIKey`; never print it.
  - Local d1 (decision model) is at `http://rrh-llm-1:4000/v1/decisions` and needs no key.
  - The `auto` decisions provider falls back to OpenAI Decisions (`gpt-6-luna`) when d1 is unreachable.

## What exists (reusable as the framework is built)

**Kernel and catalog** (the intended framework, still thin):
- `v2/kernel/{world,registry,document,params,logic,rng}.js`;
- `v2/primitives/*`;
- `v2/verify/solve.js`;
- `v2/games/*.json` (full-scale example documents).

**Generation pieces:**
- `v2/planner/decisions.js`: d1 and OpenAI Decisions behind one interface (`V2_DECISIONS=auto|d1|openai|off`).
- `v2/planner/router.js`: genre routing. Its kit-based routing should become primitive selection.
- `v2/planner/revision-check.js`:
  - diffs with identity-aware lists;
  - a guard against dropped content;
  - the original-names check (`V2_ORIGINAL_NAMES=on`; real names are the default, by the user's choice);
  - a revision-applied check, which now flags only revisions that changed nothing.
- `v2/planner/kit-pipeline.js`: schema-constrained content, validate/verify repair rounds, the art lock.
- `v2/planner/art-procedural.js` plus `v2/art/*`: code-drawn SVG art.
  - character rigs: 6 body plans, many parts, 13 archetype presets;
  - props; seamless tiles;
  - scenery: themes plus composable features, with `v2/art/ambient.js` for live traffic, leaves, weather and so on;
  - a locked art direction, so revisions repaint only the targets they name.

**Extensibility tiers** (`v2/kits/EXTENDING.md`), generalizable to primitives:
- **Mods:** `v2/kits/mods/` (weapon, falling, waves, boss, timer, shield, zones), on kit world adapters, with `snapshot()`/`applyOps()`.
- **Experiments:** `v2/experiments/`. Model-written code (default model `gpt-6-luna`), checked with `node:vm` and run in a locked-down Worker with a watchdog. Routes: `POST/DELETE /api/v2/games/:id/experiments`.
- **Promotion:** `v2/improve/`. A local Claude Code CLI job in a disposable worktree; the job verifies the result itself; Apply fast-forwards only and never pushes. Routes: `/api/v2/games/:id/promote`, `/api/v2/improve/*`. One real run succeeded (136 s).
  - `infra/cloudflare` Daytona runner: interface only.

**Kits** (to be decomposed into primitives):
- maze (Pac-Man; sizes up to 92×95 with a camera);
- shmup;
- fighting;
- puzzle (falling/chain/swap/slide);
- physics (breakout/peggle/slingshot/pinball);
- runner (lanes/side/flap/climb/dash/hop);
- creature RPG.

Each has a strict schema, a repairing validator, a bot verifier and tests. `tests/v2-kits-contract.test.js` checks them all.

**Studio** (`v2/web`): kit-player host, theater view, change box, "Try as experiment", the experiments list with "Build it properly" and Apply, and the change summaries.

**v1 overworld:** `src/generated-adapter.js` hosts arcade and kit games as venues (PR #29).

## Stopped work

- **Agent worktree `worktree-agent-a6d37640d134a467c`** (stopped mid-way). It was first briefed as a 3D action RPG kit, then redirected to the kernel framework. Review its diff before reusing anything; it may hold partial three.js host and primitive work.
- **Runner lanes corridor:** still hard-coded city (buildings, lamps, rails) whatever the scenery. The user reported "it's just city". Unfixed.
- **Live scenery (`ambient.js`):** drawn only in the fighting and arcade renderers.

## Known user feedback to honor

- Be truly general and modular. Don't take shortcuts or ship one-off patches, and don't treat example words as the full requirement.
- Delegate to subagents for scale, then integrate and verify.
- Polish by default: animation in every state, typography, look and feel.
- Revisions must be targeted: art and content keep what wasn't asked for.
- Recognizable characters when asked: real names are allowed. Never copy official artwork.
- Be honest about limits, without false "not possible" notices.
- Workstream split (AGENTS.md): Vishal owns the base game and overworld; Shishir owns the creation/improvement loop.
