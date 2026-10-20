# Mashup coverage audit — 2026-10-16

Read-only audit of all 33 original games against the current executable-component catalog and retained Composer graph-admission evidence. A successful binding check is not a runtime mechanic, complete source L2, or playable-game claim.

## Current catalog and composition-index comparison

- Executable-component index: **119 published packages, 94 typed candidates** across 31 games.
- 31 games have exact-package-pin Composer passes covering 61 package IDs; statuses are `binding_valid_obligations_unproven`. This includes newly published GTA and Tekken components whose graph receipts have not completed independent clearance by intake.
- Composition contracts index contains 115 components, 319 public ports, 298 private fields, 229 candidate relations, one indexed validated graph, and zero whole recovered L2 systems. It omits exactly four current registry IDs: `gta.component_list.insert_head`, `gta.component_list.unlink`, `tekken.collision.clear_actor_boxes`, and `tekken.collision.materialize_actor_boxes`. No extra composition entries were found.
- Two original games have no published typed candidate: `driv3r` and `final-fantasy-vi-advance`.
- All 33 have partial source-system contracts; zero complete games. Current app synchronization to the 119-entry catalog was not verified.
- Browser owner separately reports a UI-generated graph passed the live Composer endpoint and malformed graphs rejected; browser rendering and current catalog synchronization were not verified. See `research/ir-workshop/generic-assembly-20261016/frontend-validation.json`.

## No published typed candidate

- `driv3r`
- `final-fantasy-vi-advance`

## Graph clearance pending

These graphs have actual Composer pass receipts pinned to current published packages. Intake has not yet completed independent actual graph clearance; record them as passing validation with review pending, not as cleared registry graph associations.

- `grand-theft-auto`: `gta.component_list.insert_head` → `gta.component_list.unlink`; receipt `local/ir/mashup-coverage/grand-theft-auto/graph-result.json` (SHA256 `9fb781f26af5a9a491f932ae3096d7a2e438852e7e86c64483ccee681277b131`). Runtime membership/reuse invariants, scheduler and composed native behavior remain open.
- `tekken-advance`: `tekken.collision.materialize_actor_boxes` → `tekken.collision.clear_actor_boxes`; receipt `research/deep-extraction/resume/tekken-advance/coverage-pass/materialize-clear-shared.graph-receipt.json` (SHA256 `8353e79cd34856a4cf4114add671bf238fc701cdd592bed0cf684e2b3d4f497f`). The order is declared, not recovered as adjacent original calls; separator, actor integration and contact remain unmodeled. Composed graph native runs: zero.

## Positive graph admission by game

| Canonical game ID | Admitted package IDs | Bounded scope and open obligations |
|---|---|---|
| `castlevania-aria-of-sorrow` | `aria.progress.category3_acquire` | Composer validates a standalone graph with explicit collection; native finite proof 1,024 synthetic vectors; status binding_valid_obligations_unproven. |
| `crash-bandicoot-the-huge-adventure` | `crash.actor.apply_phase_payload_reset_scalar` | Reset-scalar phase payload application singleton admitted. Other published package members and connected phase execution remain untested/unproven. |
| `dragon-ball-advanced-adventure` | `db.input.actor_edges_repeat` | Input edge/repeat singleton admitted. Controller, animation and task lifecycle remain open. |
| `final-fantasy-i-and-ii-dawn-of-souls` | `ff12.choice.entry_transition` | Single component admitted both alone and as 16 ordered source invocations. Navigation/restore components are unavailable; no distinct-component composition. |
| `final-fantasy-tactics-advance` | `ffta.terrain.bounds_snapshot`, `ffta.terrain.cell_flags_stride16` | Both terrain helpers pass singleton graphs. Their source-connected bounds→cell query is not established. |
| `grand-theft-auto` | `gta.component_list.insert_head`, `gta.component_list.unlink` | Post-publication actual Composer graph admission for ordered insert_head→unlink using both current catalog package pins. The retained 780-pair source/emitted evidence covers bounded list operation subsets; graph validation does not prove runtime scheduler, general reuse invariants or composed native behavior. Same post-publication insert_head→unlink Composer graph; current package and behavior identities are explicit in the retained graph receipt. |
| `kingdom-hearts-chain-of-memories` | `khcom.effect.expiration_gate` | Expiration gate singleton admitted; a source result binding attempt failed because return_meaning is missing. |
| `kirby-and-the-amazing-mirror` | `kirby-amazing-mirror.actor.callback_phase_reset` | Callback phase-reset singleton admitted; phase-preservation connection remains open. |
| `kirby-nightmare-in-dream-land` | `kirby-nightmare.terrain.vertical_displacement_shape1` | One vertical-displacement shape singleton admitted; sampler/contact units and connections remain unavailable. |
| `legend-of-zelda-the-a-link-to-the-past-and-four-swords` | `alttp-four-swords.events.bounded_enqueue` | Single bounded enqueue call graph admitted. Timed-toggle/drain and full event lifecycle connections remain unqualified. |
| `legend-of-zelda-the-the-minish-cap` | `tmc.input.held_equipped_item`, `tmc.progress.derive_skills`, `tmc.progress.inventory_write` | Three graph admissions include source-connected inventory write→skill derivation; a held-result projection was correctly rejected for missing return metadata. Acquisition events, persistence and runtime scheduling remain outside the graph. |
| `mario-and-luigi-superstar-saga` | `mlss.motion.initialize`, `mlss.motion.reset`, `mlss.motion.update` | Three-call public lifecycle graph admitted for flags/counter only; physical motion fields remain separate private component state, so no full actor lifecycle. |
| `mario-kart-super-circuit` | `kart.steering_recovery`, `kart.track_coordinate_bounds`, `kart.turn_recovery_acceleration` | Three singleton graphs and explicit steering→turn phase graph admitted. Private steering-secondary/turn-angle alias binding rejected; bounds return meaning absent, so no invented edge. |
| `megaman-zero` | `megaman_zero.motion.command_horizontal_step` | Horizontal command step with explicit typed fields and 256-byte command collection admitted as a singleton; clock and movement lifecycle remain open. |
| `metal-slug-advance` | `metal_slug_advance.selection.entry_available` | Actual 100-index query graph admitted with bounded u16 selector domain 0..99 and typed u8 availability result. Source backing and finite return proof are pinned; full selection/child lifecycle is not covered. |
| `metroid-fusion` | `fusion.motion.directional_acceleration`, `fusion.state.transition_snapshot_reset` | Two-node acceleration→snapshot graph connects the exact shared vx field; valid=true, binding_valid_obligations_unproven. |
| `metroid-zero-mission` | `mzm.combat.minimum_reaction2`, `mzm.combat.minimum_reaction3`, `mzm.combat.reaction_tick` | Finite native parity receipt: 16,384 synthetic vectors. Current explicit graph validates a shared state connection to reaction_tick; result status binding_valid_obligations_unproven. Backend owner reports exact-pin graph validation alongside minimum_reaction2; result status binding_valid_obligations_unproven. Explicit two-component graph with minimum_reaction2; valid=true, status binding_valid_obligations_unproven; ordered [minimum,tick]. |
| `need-for-speed-underground` | `nfs.scene.request_transition` | Single-component transition-request graph admitted with both typed outputs bound and owned. |
| `pokemon-emerald-version` | `emerald.battle.paired_order_swap`, `emerald.battle.side_lookup` | Explicit side-lookup→paired-order-swap graph admitted. Alias/order, dynamic same-index and out-of-domain counterexamples rejected. |
| `pokemon-firered-version` | `firered.text.timed_acknowledgement`, `firered.text.wait_initialize` | Two-component wait-init→timed-ack graph shares source-backed u8 invocation counter; valid=true. |
| `pokemon-leafgreen-version` | `leafgreen.persistence.secure_record_decrypt`, `leafgreen.persistence.secure_record_encrypt` | Actual decode→encode graph admitted with 14 exact typed u32 word slots bound across both published packages. Payload remains source-observed opaque bitpatterns; checksum, acquisition and full persistence lifecycle remain open. |
| `pokemon-mystery-dungeon-red-rescue-team` | `pmd.input.clear_pressed`, `pmd.input.initialize`, `pmd.input.publish`, `pmd.input.suppress_repeat` | Three-root init→clear_pressed→suppress_repeat graph shares u16 state; separate publish leaf graph also passes. |
| `pokemon-ruby-version` | `ruby.input.initialize` | Standalone initializer graph admitted; one invocation, seven typed output bindings. |
| `prince-of-persia-the-sands-of-time` | `pop.clock.advance`, `pop.clock.initialize`, `pop.clock.read` | Three-call initialize→advance→read graph admitted on exact shared u32 pulse state. |
| `shaman-king-master-of-spirits` | `shaman.camera.layer1_scroll_publish`, `shaman.input.held_read` | Two separate tiny graphs admit all typed fields explicitly owned/bound; status binding_valid_obligations_unproven. |
| `sonic-advance` | `sonic.motion.gravity`, `sonic.motion.integrate` | Current-catalog revalidation admitted integrate→gravity with 8 typed bindings across 7 state slots; exact shared actor_vy and source order for this pair. Caller supplies actor/world context and eligible air-update phase. |
| `super-mario-advance` | `sma.motion.sma1_gravity_hover`, `sma.motion.sma1_jump_onset` | The gravity→jump graph preserves same-frame phase order; jump→next-gravity admits exact shared velocity and hover-count state. Grounded/fresh-button caller eligibility, frame advancement and intervening scheduler are not represented. |
| `super-mario-advance-2-super-mario-world` | `sma2.actor_contact_box`, `sma2.actor_player_relative_side`, `sma2.player_contact_box`, `sma2.shared_contact_overlap` | Four-component contact-preparation/relative-side graph shares 13 typed state slots, with 23 public bindings. Opaque modes/shape remain private; return semantics absent; no composed native proof. |
| `super-mario-advance-4-super-mario-bros-3` | `sma4.actor_pixel_mirror_sync`, `sma4.collision.actor_pair_query` | Shared camera dual-mirror graph and existing linked pair-query graph pass; camera mirror→local u8 query binding rejects width mismatch. Opaque scratch and broader collision/pool lifecycle remain open. |
| `tekken-advance` | `tekken.collision.clear_actor_boxes`, `tekken.collision.materialize_actor_boxes` | Post-publication actual Composer graph shares 20 world-box fields across 44 slots and orders materialize→clear. This schedule is explicitly declared, not recovered as adjacent original calls; separator, actor integration, contact and full 4×4 separation remain outside the graph. Same post-publication materialize→clear graph; function receipts cover 1,024 native comparisons each, while the composed graph had zero new native runs. |
| `wario-land-4` | `wl4.protection.read_query_result`, `wl4.protection.tag_query_result`, `wl4.protection.test_protected_zero_selector`, `wl4.protection.test_unprotected_zero_selector_complement` | Four published query helpers admitted in ordered query graph; valid=true, binding_valid_obligations_unproven. |

All admitted graphs remain `binding_valid_obligations_unproven`. The Composer gate checks package/catalog identity, qualified L1 and native receipt, port meaning/frame and units, explicit ownership and collection shape, order, and parameter domains. It does not prove runtime reachability/scheduling, composed native parity, full lifecycle or complete gameplay.

No ROM rehashing, native reruns, model calls, app/compiler/source changes, or broad scans were performed. Exact package ports, domains, proof paths and limitations are in `coverage-matrix.json`. Intake’s independent-clearance state is tracked separately for GTA and Tekken.
