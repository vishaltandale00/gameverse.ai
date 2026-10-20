# Gameverse handoff — paused at user request, 2026-10-16

## Stop state and operating rules

The user requested a handoff and explicitly asked to pause/stop the agents.
All three workers were interrupted and subsequently reported `interrupted`:

- `/root/automatic_ir_pipeline`: compiler, executable ontology, generation backend.
- `/root/combat_ability_progression_recovery`: now Mario coverage/evidence; previously UI and operations documentation.
- `/root/sonic_metroid_investigation`: actual native Sonic + Metroid campaign.

Do not resume without user direction. A filtered process inspection after interruption found no matching behavior-IR, Ghidra, corpus, or native playtest workers. Two existing `scripts/serve.mjs` processes remained (PIDs 94889 and 23001); these were deliberately left running. This process check is a snapshot, not a permanent monitor.

Root is coordination-only by explicit user instruction. Delegate implementation, UI, extraction and qualification. Do not browser-playtest games. Native bounded scenarios, real emulator screenshots/video and honest qualification are required. Do not stop unrelated agents when one workstream is criticized. Checkpoints are intermediate; do not declare the broader task complete at a package milestone.

Read AGENTS.md and `contracts/PARALLEL_DEVELOPMENT.md` before implementation. Preserve Vishal's base/player work and Shishir's creation/improvement workstream split. Keep checks lean, measure actual timings and retain failures. No invented timings or whole-game completion claims.

## User objective

Own-ROM decompilation → automatic executable L1 → composable L2 components → genuinely NEW GBA ROMs, playable through the normal Play UI. Extract mechanics, enemies, abilities, movement, combat, resources, progression, persistence, world interactions and their dependencies. Broad function exports, metadata keywords and isolated helper samples do not meet the objective. All games remain partial. Mario is explicitly reinstated and is the current depth priority.

Automatically recovered behavior must come from ROM/HighFunction, never downloaded decompositions or hand-recovered C as compiler input. Existing manually recovered C can guide analysis and act as a verification oracle only. Physical addresses/layout stay in L0/validation adapters; executable components need symbolic owned state, alias-preserving references, units/frames, ordering, services, lifecycle, provenance and qualification. Unknowns must stay explicit.

The guiding prompt is `/Users/shishirtandale/.codex/attachments/5c85be66-9239-4629-8c2d-1f7fc4307da0/Pasted text.txt`.

## Repository / preservation

Branch: `codex/ontology-mining-playtester`.
Authorized push destination: `https://github.com/vishaltandale00/gameverse.ai`, this branch only. User explicitly reconfirmed the exact destination after an earlier approval-review rejection; subsequent pushes succeeded.

At pause, local HEAD is `85e2139614e26e198b87bb92dadbd22de49da871`; local remote-tracking ref is `2f05a2ba148177ddadde1279f553936a8271867c`. The evidence agent reported pushing 85e2139, but tracking is behind. Verify remote identity/state when resuming; no fetch/push was done for this handoff.

Important checkpoints:

- `5e024ff`: initial automatic compiler/new-ROM slice.
- `b815888`: functional IR Workshop, upstream voice/UI alignment and operations docs.
- `ba73729`: expanded automatic compiler/catalog and real composition generation.
- `6815b11`: native moving-handle/plane Sonic contracts (includes compiler checkpoint).
- `2f05a2b`, `85e2139`: deeper Mario evidence and form/projectile dependencies.

The checkout has extensive modified and untracked research, compiler, catalog and game files. Preserve all of it. Do not reset, clean, blindly stage everything, or assume HEAD contains latest qualified artifacts. ROMs, assets, private saves, generated native media and local receipts are generally ignored under `local/`; keep those locally. Never commit keys or `.env.local`.

## Automatic IR pipeline

Start with:

- `research/automatic-ir/README.md`
- `research/automatic-ir/status.json`
- `research/automatic-ir/mario-mechanic-coverage.json`
- `tools/behavior_ir/CONTINUATION.md`
- `local/ir/automatic-queue.json`
- `ontology/executable-components/index.json`
- `tools/behavior_ir/` (compiler and real generator).

Actual status snapshot read at pause: `ONGOING_ALL_GAMES_PARTIAL`; 33 ROMs; 29 depth_pending, two reused baselines, two retained discovery failures. Bounded discovery exported 22,087 L0 functions and found 2,271 static L1 candidates. These are NOT complete-ROM coverage or usable-component counts. There are 43 retained finite-native-qualified behaviors, 18 typed-port subsets and 648,949 retained fixture pairs. Finite qualification is not proof of every state or full mechanic closure.

Clean-ROM combinations have actually completed traversal → three enemy defeats → acquisition/derived capability → gate → exit. Sources span Sonic, Zero Mission, Minish, Aria and Mario subsets. Authored world, projectile/contact, gate and rendering IR are explicitly distinguished from recovered behaviors. Multiple movement/progression selections and composition-only variants were exercised, not only damage tweaks. Saved failures remain in status records. Exact receipts/media live under `local/ir/generated/`.

Recent compiler advances: structured switches, indexed collections, return-valued dependency linking, shared symbolic call views, proper callee early-return scopes, observed multi-object domains, live r2 ABI restoration, original shared-world actor backing and signed packed-field demand. Latest new files include `boundary.py`, `causal.py`, `domain.py`; many compiler edits are uncommitted.

Current blockers: canonical aliased entity pools/handles and shared world state; loops, dynamic callbacks and unresolved pointers; distinguishing mechanically necessary audio/render clocks from optional services; complete controllers, terrain, enemy/ability/projectile lifecycles, scene progression and persistence. Do not flatten overlapping objects into independent copies.

Continue after checkpoints through the durable queue. Resource caps bound batches, not the overall objective. Publish qualified components to the site and repeatedly generate materially different multi-game NEW-ROM compositions with bounded native QA, incompatibility diagnostics and actual artifacts.

## Mario evidence / depth

Evidence agent owns `research/deep-extraction/mario/`; compiler agent owns executable packages and backend. The coverage file is coordinated between them. All five Mario games are explicitly incomplete, including Superstar Saga and Kart, not just SMA1/2/4. There are 44 open mechanic-family obligations and a latest evidence registry of 75 hashed causal targets.

Actual advances include SMA1 original jump and finite-hover policies with ROM character profiles; death update → original Y integration, including life/timer behavior; SMA2 gravity, form/hurt/release/integration subsets; SMA4 pair reaction retaining real r2 and integration across the shared 18-slot actor world. Mario/Peach clean-ROM compositions and held/released hover witnesses passed. These do not constitute complete controllers or games.

Latest evidence closes the causal map from SMA2 acquisition/form/reserve selection → legal fire → two-slot projectile pool → terrain/enemy reaction → impact lifetime → cleanup and capacity reuse. Direct special fields overlap enemy slots 7/9; independent copies would be incorrect. Invulnerability expiry lives inside a presentation update and is mechanically required. Retry/game-over scene consumers, full terrain/controllers, enemies/bosses, forms, world progression and persistence remain unfinished. No new manual-C recovery campaign should replace automatic lifting.

## Sonic + Metroid campaign

This remains separate from the small clean-ROM compiler demonstrations. Do not describe a compiler demo as the complete Sonic game. The campaign currently retains Sonic's engine/world and uses explicit IR packages/host bridges; it is not itself a wholly new-ROM implementation yet.

Stable candidate21: all eight abilities acquired through one real fresh-game ancestry; loops/momentum, weapons/resources, Morph/Bombs, renewable freeze-creature platform/gate, High/Speed, original first boss/capsule, Factory/Varia heat protection, earned return relays, Screw and organic seal. Native lifecycle/physics/scene contracts are pinned. Later campaign/boss/finale acceptance is still incomplete.

Candidate22 replaced duplicated authored HP arithmetic with automatically generated serialized-L1 Zero Mission impact behavior, explicit state sidecars and native Sonic death/drop ownership. Candidate23 fixes native moving-handle attachment/release authority and collision planes; Factory2 upper-route traversal demonstrated without teleport/state injections.

Latest reported candidate25 ROM SHA256:
`f1faa36558ae5d7ccacfc94292201b63c7a870803464a2f4d2699c6654bf6bf1`.
It includes genuine recovered Zero Mission Ripper controller and original five-frame sprite assets in the actual Sonic campaign: 20 IR packages, 115 prefabs, 13 hooks, 27,032-byte payload; clean build 0.775 s. Controller qualification: 6,912 original/host/emitted comparisons. Native VRAM tiles, palette and OAM were checked against extracted source bytes. Freeze/patrol/resume and all-eight-ability return route passed. Media: `local/re/experiments/20261016-sonic-self-decompile/signal-descent-25-ripper-visible/`; compact proof `research/requests/mzm-ripper-native-game-proof.json`.

At interruption, agent was adding optional authored habitat bounds via the recovered terrain-classification port for a repeatable Ripper turn/freeze/return witness. Treat those latest local changes as unfinished, not candidate25-qualified. Later Factory route/finale remains open. Preserve candidate25 and prior exact receipts separately.

## UI, generation and operations

Site remains at `http://127.0.0.1:4173/`.
Workshop: `http://127.0.0.1:4173/v0?view=workshop`.
Play: `http://127.0.0.1:4173/v0?view=play`.

Functional Workshop uses actual executable options, concrete package pins and typed selection → server generation → clean-ROM build → native QA → explicit Add to Play. SKILL RELAY was registered. Real three-game application proof is `research/ir-workshop/integration-qualification.json`; final focused checks in `application-verification.json`. No browser game testing was performed. Catalog is dynamic; latest compiler subsets appear without inventing UI options. Unsupported combinations must show real blockers. The UI is not a promise of arbitrary whole-game composition.

Relevant implementation: `src/ir-workshop*.js`, `scripts/ir-api.mjs`, `scripts/serve.mjs`, `tools/behavior_ir/generate.py`. Vishal's voice/geometry changes through main b58ae3e were integrated additively; v1 retains FireRed-only policy, IR registration is in v0. Existing source games/progress remain separate and ROM-hash bound.

Read `OPERATIONS.md`, `FRONTEND_WORKSHOP.md`, `.env.example`, and README for exact commands/credentials. At last credential audit, ignored `.env.local` contained OPENAI_API_KEY only. Deterministic IR generation/native QA require no model key. Local d1/embeddings use LITELLM_API_KEY/LITELLM_BASE; d1 uses POST /v1/decisions with proxy-specific protocol. System2 has PLAYTEST_LLM_* settings. Embeddings cache NPZ/JSON locally; no vector DB required at current scale. Never copy actual secrets into handoff or Git. Documentation should remain tied to actual clients, not assumed APIs.

## Resume order

1. Obtain user direction to resume; inspect dirty checkout and current remote without losing artifacts.
2. Restart original workers with their exact ownership and explicit comprehensive objective. Root coordinates only.
3. Continue alias-preserving Mario component closures, evidence inventory and NEW-ROM composition trials; keep all unfinished mechanics visible.
4. Continue native Sonic route/content and true Metroid ecology/IR integration without declaring later campaign acceptance complete.
5. Keep dynamic site/catalog truthful. Presentation and generalized harness improvements remain desired, but avoid displacing mechanics/compiler work or running unnecessary repeated suites.

The current session still exposed four active-agent slots total despite the user's configuration discussion about 50; do not assume the higher limit took effect. No agents were restarted for this handoff.
