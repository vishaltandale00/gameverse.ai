# 33-game contribution inventory

Snapshot written 2026-10-16T15:17:42.957849+00:00. Research export commit `85e2139614e26e198b87bb92dadbd22de49da871`, exported `2026-10-16T15:15:10.072329+00:00`; source inputs updated through `2026-10-16T15:15:01.854459+00:00`. Producer dispatch snapshot: `2026-10-16T15:13:35.794531+00:00`.

There are 33 catalog games; 26 have canonical component records. The current research export exposes 20 game reconstruction maps with 145 total phases. The server exposes 12 current manifest entries and 9 fixed API route IDs. Five fixed unique modules are UI-ready beyond the dynamic manifest; the older Sonic route is not UI-ready and shares its module ID with a dynamic entry. The workspace can add 17 unique modules across 14 games. 19 games have no executable prefab module to add.

## Games with no currently addable prefab module

`crash-bandicoot-the-huge-adventure`, `driv3r`, `final-fantasy-i-and-ii-dawn-of-souls`, `final-fantasy-tactics-advance`, `kingdom-hearts-chain-of-memories`, `kirby-and-the-amazing-mirror`, `kirby-nightmare-in-dream-land`, `legend-of-zelda-the-a-link-to-the-past-and-four-swords`, `mario-and-luigi-superstar-saga`, `metal-slug-advance`, `metroid-fusion`, `need-for-speed-underground`, `pokemon-firered-version`, `pokemon-leafgreen-version`, `pokemon-ruby-version`, `prince-of-persia-the-sands-of-time`, `shaman-king-master-of-spirits`, `super-mario-advance`, `super-mario-advance-2-super-mario-world`

The dynamic-manifest-only zero set remains in JSON (22 games). Producer dispatch separately tracks 15 source-allowlisted candidates across 14 games, while its `product_accepted_prefab_count` is null. A producer allowlist or delivery record alone does not make a product choice available.

## Fixed route identities

| Game | module ID | route IDs / variants | UI ready | Scope |
|---|---|---|---:|---|
| `metroid-zero-mission` | `mzm.enemy.accepted-damage-and-reaction` | `mzm.enemy.accepted-damage-and-reaction` | yes | Explicit accepted-contact and later eligible-reaction phases; no contact admission or full encounter. |
| `legend-of-zelda-the-the-minish-cap` | `tmc.learned_sword_charge_release` | `tmc.learned_sword_charge_release` | yes | Persistent learned-state write, explicit capability refresh and equipped-input query; sword consumer remains source-only. |
| `castlevania-aria-of-sorrow` | `aria.soul_inventory_to_cast_lifecycle` | `aria.soul.acquire.category0`, `aria.soul.acquire.category1`, `aria.soul.acquire.category2`, `aria.soul.acquire.category3` | yes | One mutually exclusive category specialization of shared acquisition module; do not count four instances. |
| `sonic-advance` | `sonic.usa.character_traversal.air_phase` | `sonic.usa.character_traversal.air_phase` | no | Two-stage integration→gravity graph is bounded internal subset; source plan marks this candidate not readyToAdd. Same module identity already appears in dynamic manifest. |
| `wario-land-4` | `wario-land-4.normal-form-protection-hazard` | `wl4.protection.query_subset` | yes | Stored protection predicate query only; timer mutation and hazard admission remain source-only. |
| `tekken-advance` | `tekken.actor_box_contact_phase` | `tekken.actor.geometry_publication_reset` | yes | Clear-first actor geometry materialization over shared boxes; collision decision and full fight lifecycle remain open. |

Four Aria category routes share one module and are mutually exclusive specializations. Sonic’s fixed route shares the same module identity as its dynamic manifest prefab and is not independently UI-ready. Each fixed route’s graph, validation and descriptor refs plus SHA-256 are in the JSON.

## Exposed blueprint patterns

`ontology/composition-contracts/patterns.json` exposes 6 internal patterns and 14 roles. These are binding motifs, not player-intent plans or complete systems.

- `jump-next-gravity`: gravity (sma.motion.sma1_gravity_hover); jump (sma.motion.sma1_jump_onset)
- `prepare-bounds-compare`: player_box (sma2.player_contact_box); actor_box (sma2.actor_contact_box); overlap (sma2.shared_contact_overlap); relative_side (sma2.actor_player_relative_side)
- `initialize-poll-wait`: waitInit (firered.text.wait_initialize); timedAck (firered.text.timed_acknowledgement)
- `minimum-next-reaction`: minimum (mzm.combat.minimum_reaction2); tick (mzm.combat.reaction_tick)
- `decode-encode-record`: decode (leafgreen.persistence.secure_record_decrypt); encode (leafgreen.persistence.secure_record_encrypt)
- `count-before-acquire`: count (source-only); acquire (aria.progress.category3_acquire)

## Per-game factual inventory

| Game ID | genre | canonical components | qualified packages | addable modules | workspace loop phases | source cards (partial / observed / unverified) | exposed pattern roles |
|---|---|---:|---:|---:|---:|---:|---:|
| `castlevania-aria-of-sorrow` | — | 41 | 6 | 1 | 7 | 5 / 2 / 0 | 1 |
| `crash-bandicoot-the-huge-adventure` | — | 1 | 6 | 0 | 7 | 0 / 3 / 3 | 0 |
| `dragon-ball-advanced-adventure` | — | 1 | 3 | 1 | 8 | 0 / 3 / 3 | 0 |
| `driv3r` | — | 0 | 1 | 0 | 0 | 0 / 3 / 3 | 0 |
| `final-fantasy-i-and-ii-dawn-of-souls` | — | 1 | 1 | 0 | 0 | 0 / 3 / 3 | 0 |
| `final-fantasy-tactics-advance` | — | 23 | 2 | 0 | 0 | 5 / 2 / 0 | 0 |
| `final-fantasy-vi-advance` | — | 0 | 0 | 1 | 8 | 0 / 3 / 3 | 0 |
| `grand-theft-auto` | — | 0 | 2 | 1 | 8 | 0 / 3 / 3 | 0 |
| `kingdom-hearts-chain-of-memories` | action_rpg, card_battle, dungeon_crawler | 60 | 1 | 0 | 7 | 6 / 2 / 0 | 0 |
| `kirby-and-the-amazing-mirror` | — | 0 | 1 | 0 | 0 | 0 / 3 / 3 | 0 |
| `kirby-nightmare-in-dream-land` | — | 0 | 3 | 0 | 4 | 0 / 3 / 3 | 0 |
| `legend-of-zelda-the-a-link-to-the-past-and-four-swords` | — | 0 | 1 | 0 | 6 | 0 / 3 / 3 | 0 |
| `legend-of-zelda-the-the-minish-cap` | action_adventure, top_down_adventure | 63 | 5 | 1 | 0 | 6 / 2 / 0 | 0 |
| `mario-and-luigi-superstar-saga` | — | 33 | 3 | 0 | 8 | 3 / 2 / 1 | 0 |
| `mario-kart-super-circuit` | — | 23 | 3 | 1 | 10 | 3 / 2 / 1 | 0 |
| `megaman-zero` | — | 6 | 1 | 1 | 5 | 0 / 3 / 3 | 0 |
| `metal-slug-advance` | — | 7 | 1 | 0 | 6 | 0 / 3 / 3 | 0 |
| `metroid-zero-mission` | metroidvania, action_platformer, action_adventure | 55 | 9 | 3 | 9 | 7 / 1 / 0 | 2 |
| `metroid-fusion` | metroidvania, action_platformer, action_adventure | 69 | 2 | 0 | 0 | 6 / 2 / 0 | 0 |
| `need-for-speed-underground` | — | 0 | 1 | 0 | 0 | 0 / 3 / 3 | 0 |
| `pokemon-emerald-version` | monster_collecting_rpg, turn_based_rpg, top_down_adventure | 62 | 2 | 1 | 9 | 7 / 1 / 0 | 0 |
| `pokemon-firered-version` | — | 28 | 2 | 0 | 8 | 6 / 2 / 0 | 2 |
| `pokemon-leafgreen-version` | — | 28 | 2 | 0 | 0 | 6 / 2 / 0 | 2 |
| `pokemon-ruby-version` | — | 26 | 1 | 0 | 7 | 6 / 2 / 0 | 0 |
| `pokemon-mystery-dungeon-red-rescue-team` | roguelike, dungeon_crawler, monster_collecting_rpg | 57 | 4 | 1 | 5 | 6 / 2 / 0 | 0 |
| `prince-of-persia-the-sands-of-time` | — | 7 | 4 | 0 | 0 | 0 / 3 / 3 | 0 |
| `shaman-king-master-of-spirits` | — | 1 | 2 | 0 | 0 | 0 / 3 / 3 | 0 |
| `sonic-advance` | momentum_platformer, action_platformer | 51 | 5 | 1 | 9 | 6 / 2 / 0 | 0 |
| `super-mario-advance` | — | 2 | 5 | 0 | 0 | 1 / 3 / 2 | 2 |
| `super-mario-advance-2-super-mario-world` | — | 4 | 24 | 0 | 0 | 2 / 3 / 2 | 4 |
| `super-mario-advance-4-super-mario-bros-3` | — | 6 | 11 | 1 | 7 | 3 / 3 / 1 | 0 |
| `tekken-advance` | — | 1 | 2 | 2 | 7 | 0 / 3 / 3 | 0 |
| `wario-land-4` | — | 42 | 4 | 1 | 0 | 6 / 2 / 0 | 0 |

## Reading the counts

The JSON keeps qualified package records, dynamic manifest graphs, fixed API routes, UI-visible modules and source delivery candidates separate. Graphs include invocation, package and service counts; packages retain readiness and assembly status. Per-game records include exact source-only card IDs/evidence, exposed roles, source delivery/map refs, core-loop phases and input fingerprints.

An addable module is not automatically a useful primary core-loop contribution. That semantic decision remains with the contribution review. Helpers, source-only cards and single Composer admissions do not qualify a complete system. “No map in current research export” means the workspace reconstruction map is not published in this snapshot; separate producer delivery and source map refs are recorded where available.
