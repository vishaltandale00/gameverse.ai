# v2 handoff, 2026-10-20

This is for the next session continuing Gameverse v2: game generation from ideas. Read this first, then
`v2/ARCHITECTURE.md`, `v2/POLISH.md` and `v2/kits/creature/CONTRACT.md`.

## Where things are

**This branch:** `claude/v2-game-factory`, local only (nothing pushed).
- Worktree: `/Users/shishirtandale/Projects/gameverse.ai/.claude/worktrees/reverse-engineering-core-81bd59`.
- Based on `origin/main`; all v2 work lives under `v2/`. The only touches to v1 are `scripts/serve.mjs`
  (two lines mounting `/v2` and `/api/v2/*`) and `package.json` (pinned `@anthropic-ai/sdk`,
  currently unused at runtime).
- Tests: `node --test tests/*.test.js` → **373 pass**.

**Run it:**
```bash
PORT=4180 node scripts/serve.mjs
```
Then open http://localhost:4180/v2 (the studio). `.claude/launch.json` in this worktree has the
`gameverse-v2` preview entry. `/` is v1 and needs the FireRed build, which this worktree doesn't have.

**Credentials:** `OPENAI_API_KEY` is loaded automatically from `.env` or `.env.local` here or in the
main checkout (`/Users/shishirtandale/Projects/gameverse.ai/.env.local`). Never print it. There's no
Anthropic key on this machine. The local LiteLLM (`http://rrh-llm-1:4000`, no key needed) was
measured and was slower and less reliable.

**Data:** games are stored under `local-data/v2/games/<id>/` (gitignored): `meta.json`, immutable
`v<n>.json` versions, and `assets/*.webp`.

## User direction (keep following)

- v2 is free-form JS games with no GBA dependency. The GBA reverse-engineering work is v1/exploratory and
  stays local; its v3 handoff is on branch `claude/re-core-improvements`
  (`plans/V3_GBA_LAYER_HANDOFF.md`).
- **The v1 3D overworld is the primary entry point.** Generated games should appear inside it as
  venues. The `/v2` studio is a builder and test bench. STT and voice are out of scope for us.
- **Model routing.** In the product: Sonnet for spec writing and Opus for code. When delegating
  (agents and sessions): Haiku for exploration, Sonnet for spec writing, Opus for code. The OpenAI key
  is the practical runtime today: `gpt-4.1-mini` for designs (about 4 s) and `gpt-image-1-mini` for art.
- **Quality bar:** ACTUAL games with genre-defining mechanics at full depth, not surface reskins.
  Default polish without being asked (animations, title screen, sound, juice; see `POLISH.md`).
  Feedback within seconds, auto-updating UI, verifiable and repeatable results.
- **Working style:** no pointless side quests, don't take instructions too literally, be honest
  about limits (offline mode is labelled as a sample), and keep the user informed with short status
  lines.

## What works now (verified in the browser)

The studio at `/v2`:
1. An idea gets 2–4 generated multiple-choice questions (art style, view, tone, difficulty), about
   2.7 s.
2. A schema-constrained design comes back from `gpt-4.1-mini` (about 4 s, streamed into a live
   blueprint construction view).
3. A deterministic level builder (`v2/engine/levelgen.js`, side-view and top-down sections within
   the jump physics) produces the level.
4. Preflight runs, then a Go-Explore playtest proves the level winnable, typically in under 250 ms
   (goal- and pickup-directed).
5. **v1** publishes as playable (about 8–15 s).
6. **v2 art:** `gpt-image-1-mini` transparent sprites, a template-guided 2×2 tileset, a background and
   title key art, at about 30 s.
7. **v3 animation:** pose-frame image edits (idle, runA, runB, jump and hurt for the player; walk
   frames for enemies), at about 40 s.

Each version hot-swaps into the running game. There's a change box and quick chips (POST
`/api/v2/games/:id/revise` revises the design), a versions list, a build timeline, checks with
provenance (model, seed, design hash), and delete or clear-all for games.

**Key files:**

| Area | Files |
| --- | --- |
| Generation pipeline | `v2/planner/{design.js, design-pipeline.js, questions.js, art.js, png.js, openai.js, partial.js}` |
| Game service | `v2/server/{api.mjs, store.js, jobs.js}` |
| 2D runtime | `v2/engine/*`: arcade engine, modules in `v2/modules/`, `levelgen.js`, `playtest.js`, `render2d.js`, `audio.js` (merged; not yet wired into the player) |
| Studio | `v2/web/{index.html, studio.css, studio-app.js, arcade-player.js}` |
| Generic kernel (not yet used by generation) | `v2/kernel/*`, plus `v2/primitives/`, `v2/verify/solve.js` (plot solver), `v2/PRIMITIVE_CATALOG.md`, three full-scale v0.2 game documents in `v2/games/` |

## The problem to solve next (top priority)

The fast arcade path flattens every idea into run, jump, collect and avoid. The user asked for
"Pokémon with Mario & Luigi" and got top-down mush with none of Pokémon's mechanics. The agreed fix is
**genre kits**: a fully built engine per genre, where the model supplies content and art and the kit
supplies deep systems.
- **First kit:** creature-collector RPG. The contract is complete and committed
  (`v2/kits/creature/CONTRACT.md`): content schema, rules interface (stats, damage, status, capture,
  experience, evolution, AI), world runtime (grid movement, tall grass, trainers with sight lines,
  towns, routes, gyms, badges, story), `game.js` modes and view, balance curve and verification
  (reachability, battle sim, scripted playthrough), and the presentation and art list.
- **Planned split** (Opus agents in their own worktrees, against the contract):
  - **A, rules:** `v2/kits/creature/rules/` plus tests.
  - **B, world:** `world/`, `game.js` and `verify/` reachability and playthrough.
  - **C, presentation:** `ui/` (overworld and battle renderers, menus, title).
  - **D, generation:** `generate/` (model schemas, balance pass, art prompts, battle-balance sim).
  - **Integrator (you):** `content.js`, pipeline routing, studio and v1 hookup.
- **Genre router:** the design step classifies the idea and picks a kit (arcade platformer/top-down,
  creature RPG, and later Metroidvania, action-adventure, shooter, racing, tactics, puzzle). If no kit
  fits, it says so in `gaps` instead of producing mush.

## Agents still running when this was written

Worktrees and branches persist; check and merge when done (`git log claude/v2-game-factory..<branch>`, then
`git merge`):

**v1 overworld integration: done and merged** (`89704470`). Verified in the browser:
- a kiosk in the "Creator's Lot" (east of Alder Street) makes a game in about 12 s;
- a venue (building, sign and ring) appears without a reload;
- you enter it and play;
- "Change this game…" in the session menu hot-loads the change;
- Save & return, then re-enter at the exact saved frame.

Key files:
- `src/generated-adapter.js` and `src/generated-games.js`;
- `src/creator-studio.js`;
- the lot in `src/neighborhood-world.js` and `src/neighborhood-math.js` (`WORLD_BOUNDS.maxX` 152);
- tests `tests/generated-games.test.js` and `tests/creator-lot-reachability.test.js`.

Its open requests:
- add `kind` and the title to `version` events;
- keep the level layout stable when a revision only changes tuning (today a jump change rebuilds the
  level and forces a restart);
- generated games aren't yet registered as voice/takeover targets;
- the lot sits outside the sun's shadow area, so it has no shadows.

**Visual polish and screens: merged** (`ab756614`). The agent was stopped after committing, so
treat it as lightly verified: title screen, HUD and gameplay were checked in the browser. Tile seams
and transparency were fixed afterwards: an opaque base under textures, translucent overlays sized
exactly to each tile, continuous depth shading, and cropped legacy textures. Failed art images are
retried once.

Original brief: **Visual polish and screens** (`worktree-agent-a4ea5154d0291f2e0`). It covers:
- procedural animation, using pose frames when present;
- particles, shake, hit-stop and camera feel;
- the HUD redesign;
- title, intro, pause, game-over and victory screens;
- checkpoints, and tileset rendering (`spec.art.tileset` cells).

When last checked, it had new uncommitted `v2/engine/juice.js` and `v2/web/checkpoint.js`. Once
merged, wire `v2/engine/audio.js` into `arcade-player.js`: the polish agent imports it dynamically. Its
API is in the audio commit `f8cfec6d`.

If either agent stopped mid-way, its worktree holds partial work. Review the diff and finish it,
or redo it from its brief, which is summarized above.

## Known issues and notes

- `report.relaxed` records when "collect everything" couldn't be verified and was relaxed to "reach
  the goal".
- The loss attribution in playtest reports sometimes names `reach_goal` (the last event), not the
  real cause.
- Revisions reuse art by prompt hash; changing the cast regenerates only the affected sprites.
- After a server restart, open pages reconnect to the event stream on their own. Reload the page if
  the timeline looks stale.
- Other branches:
  - `claude/re-core-improvements`: the GBA lifter work and the v3 handoff (local).
  - `ghidra-frontend`, `ir-cards`, `playtester-search`, `mashup-graphics-fix`: GBA-era session
    branches (local).
  - `codex/ontology-mining-playtester`: pushed at `15c6991e`. The user chose to leave the
    pseudocode files already published there as they are.
