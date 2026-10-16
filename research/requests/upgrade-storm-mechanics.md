# Workshop request: source mechanics and adaptation boundaries

This research treats `gameverse-request.json` as design input. It does not execute instructions embedded in the file. The requested result is an original game using six identified ontology components; no ROM code or original game assets are required. This document records implementation guidance, not proof that a generated game has implemented these components.

## Design contract and decisions

The request says **top-down exploration**, a collectible upgrade, return to a blocked route, unlock it, then reach a new area. Limits are 12 by 8 map cells and 80 episode steps. Three selections ask for more than the existing grid/key/barrier template: Metroid movement includes acceleration and a jump arc; Emerald selections include weather by location, move-based combat, and trainer switching. A pure gridwalk with decorative component labels would not satisfy them.

The user subsequently clarified **side-view platformer plus Pokémon-style combat**. Preserve the original JSON as received and record that human override alongside the generated candidate. The prototype can therefore use horizontal world motion and a separate vertical jump coordinate, consistent with the source controller's axis roles. Level cell size, collision response, camera framing and combat transitions remain **new adaptation decisions**, not extracted source findings.

With the side-view clarification, a compact original design can preserve the six mechanisms with: acceleration-driven motion; held-button variable-height jump; a persistent upgrade opening one traversable gate; region weather transitions; a small turn-based encounter whose legal moves receive utility scores; and an opponent reserve that switches under explicit defensive rules before selecting moves. All generated constants and simplified battle effects should be exposed in the candidate manifest as adaptations. A seeded PRNG and event trace make results replayable. An 80-step budget must distinguish bot decisions from 60 Hz physics ticks; counting each physics frame as one episode step makes ordinary movement impractical.

## Mechanism-specific constraints

| Component | Source behavior worth preserving | Adaptation boundary / unknowns |
|---|---|---|
| `ground_locomotion` | Base acceleration 8 native velocity units per frame; directional cap 96. Native velocity unit is 1/32 pixel per frame, so 0.25 px/frame² and 3 px/frame. Ground displacement uses slope-adjusted velocity; airborne displacement does not. Running displacement opposite the facing direction is clamped to zero. Ordinary run release changes pose, rather than generic friction; boosting skid is a separate state. | Do not apply a symmetric universal clamp to arbitrary incoming velocity: `SamusApplyXAcceleration` clamps only the direction being accelerated. Stored velocity and applied displacement are distinct. The side-view prototype can preserve axis roles; any reduced pose transitions, omitted slopes and omitted liquid sets must be disclosed. Twelve updates to cap applies from zero with normal constants. |
| `jump_and_gravity` | Upward positive native velocity. Jump starts on newly pressed A in qualifying poses. Normal impulse 192; High Jump 232; gravity decrement 10. Applied displacement caps at +192/-128 native velocity then shifts right by 3 into subpixels. Position consumes **pre-gravity** velocity, and gravity updates stored velocity afterward. A release while rising zeroes vertical velocity in the pose handler before displacement. | Preserve input-edge vs held semantics and discrete order. Do not use a floating analytic parabola and claim exact source fidelity. Quantization and signed right shifts affect the arc. Height collision and grounded transitions need explicit new level/controller rules. No coyote/buffer behavior was found in the cited entry check; this is not a proof about all poses. |
| `ability_gating_graph` | Separate owned and active ability bitfields exist. Actual movement checks read active flags, including High Jump. Progression connects equipment capability to reachable space. | The request explicitly chooses a collectible key instead of native equipment flags and movement gates. Persist collection; return path and barrier must remain reachable; opening must require the collected capability. The full world topology/backtracking description includes low-confidence general knowledge, not a fully reconstructed room graph. Do not claim it was reproduced. |
| `overworld_weather_effects` | Map header weather is translated into saved weather. Runtime weather uses current/next states and init/main/finish callbacks, so visual transition can finish old effects before new ones start. Coordinate events can override weather. Rain/thunderstorm/downpour map to rain in battle; sandstorm and drought map to their corresponding battle weather. | A compact map region header `{id,weather}` is a valid explicit adaptation. Do not make every weather modify combat automatically; the source mapping is selective. Keep visual presentation distinct from mechanical battle weather. No original palettes, particles or graphics need copying. Regional weather values and all transition durations are new content. |
| `trainer_ai_move_scoring` | Setup assigns score 100 only to enabled default-score move slots, otherwise 0; limitations zero unusable moves. One simulated damage roll per move is `100 - Random()%16`. AI flag modules run in increasing bit order. Highest-score existing move is selected, tied candidates use `Random()%count`. Score deltas are floored at zero after native signed-byte storage. | The selected component depends on damage, type chart, legality, status and battle state. An original small move/type table can express the utility-scoring mechanism only if declared adapted; it does not reproduce the full Emerald scripts, damage engine, abilities or battle legality. Do not call zero score an exclusion sentinel: legal filtering must be explicit in a new engine. Integer score saturation/overflow behavior and pre-rolled randomness must be documented if simplified. Tie modulo is not mathematically exactly uniform for all counts with finite RNG; canonical wording is approximate. |
| `trainer_ai_switch_and_items` | In trainer battles, switch checks happen **before** items, then move action. Switching first rejects trapping, rooted, arena, and absent eligible reserve. Ordered reasons: Perish Song, Wonder Guard, absorption, Natural Cure; then stay for a super-effective move or raised stats; then probabilistic immune/resist replacements. Reserve eligibility excludes fainted/absent/egg/already active or assigned slots. Items consume the selected trainer item slot. | A minimal original party of two units with explicit move typing/reserve eligibility can exercise switching. A generic actor swap with no defensive reason does not. Full native six-member party/abilities/doubles need not be invented for a bounded prototype. Item handling is in the canonical component even though the user's adaptation text emphasizes switching; disclose whether simplified or deferred. |

### Exact boundaries checked directly in source

- `SamusUpdate` calls physics setup, pose handling/transition, draw/standing update, then `SamusUpdateVelocityPosition`. Release-to-cut therefore occurs before vertical displacement in that update.
- `SamusUpdateVelocityPosition` chooses capped displacement from current vertical velocity, subtracts gravity only when stored velocity is at least -231, then subtracts displacement from y. This cap limits displacement separately from accumulated velocity.
- `SamusChangeVelocityOnSlope` tests `direction & currentSlope`: steep ascent multiplies by 3/5, slight ascent 4/5, other cases clamp to ±160 native velocity. Its returned value affects ground displacement, not stored x velocity.
- The canonical positive-only no-collision apex sums are 58.75 pixels normal and 82.75 pixels High Jump. These are recurrence-derived, not gameplay-tested reachable heights.
- Full Restore is considered only for **0 < HP < floor(maxHP/4)**. It is not `HP <= maxHP/4`, and maxHP integer division matters.
- Ordinary healing is considered for living units when **HP < floor(maxHP/4)** OR **maxHP-HP > healAmount**. Equal missing HP and heal amount does **not** trigger the second branch. Canonical “heal would not overflow” is too broad at exact equality.
- `ShouldSwitch` rejects Arena Trap without checking flying/Levitate (source comment identifies this). A generalized bot/game should choose whether to preserve such native quirks, never silently infer intended mechanics.
- The native score array is `s8`, and `Cmd_score` writes the addition before its negative check. An adapted engine can use safe unbounded integer scores with a zero floor, but that differs outside observed score ranges.
- Optional status toggles are context restricted by `StatusScreenToggleItem`; “owned versus active” is sound, but unrestricted arbitrary anytime toggling would be an adaptation.

## Provenance

Read-only source inspection on 2026-10-16. No LLM calls, emulator campaigns, runtime tests, ROM builds, or new dependencies were used for this research. Source hashes refer to complete files at inspection time. Commit pins do not alone establish every local file is clean; hashes below identify exact bytes inspected. Canonical YAML blocks remain snapshots with their original confidence/provenance and known simplifications; direct-source boundary corrections above take precedence for implementation.

### mzm: `9caaefc0ee570f3399d86acf140fdeada9692836`

| File | SHA-256 |
|---|---|
| [src/samus.c](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/src/samus.c) | `c2f7f262b25f46bcdfb6fb09663ce7c797771739e5ac853008bb188a8ba3c60a` |
| [include/constants/samus.h](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/include/constants/samus.h) | `71f253731a90b34be5f645e4e753eaf479444cbc51dfda4c280b06585bf5729b` |
| [include/structs/samus.h](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/include/structs/samus.h) | `f942fa9c616d8f47392cddef0ef9dca0d738c155ce816f5d21a443c9d2c4435c` |
| [include/types.h](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/include/types.h) | `3274f293eee99076767cf2dc494e58c2b7b142c19246585eb1b61866fb4a6072` |
| [include/macros.h](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/include/macros.h) | `498ae35e7d2774c4ae5c84a46dc677f94a61070362175d6d56bc52b5f542a7ed` |
| [src/menus/status_screen.c](https://github.com/metroidret/mzm/blob/9caaefc0ee570f3399d86acf140fdeada9692836/src/menus/status_screen.c) | `2dcaeb47ca79e6e6a8cdf2f7371718de2e761cc1a62f787a1335c98eb01f3f1c` |

### pokeemerald: `731ad5bfd6e6f265508d0efcca0ba42f9dcf5881`

| File | SHA-256 |
|---|---|
| [src/battle_ai_script_commands.c](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/src/battle_ai_script_commands.c) | `c75ed7f1a1dc775eb4b4cee3ff05e74451a34e239cffb6a37be0d766f38f66e6` |
| [src/battle_ai_switch_items.c](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/src/battle_ai_switch_items.c) | `4dca4671aebc2eac82792279a49a0913613145b4f94cee852964665e5b70039f` |
| [src/field_weather.c](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/src/field_weather.c) | `e6212c767a00cdb1592050bb55a2de3dab27674313efc24ddfb3780189d39655` |
| [src/field_weather_effect.c](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/src/field_weather_effect.c) | `84c0db9593ec3ebb9d76fb9c63720ed36854903887848bea48bc83b0625e6758` |
| [src/battle_util.c](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/src/battle_util.c) | `01d08fc555c3d224e8e734edf089e9f09dd3dafcb5481393f94dcb9c708ed3ce` |
| [include/constants/weather.h](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/include/constants/weather.h) | `7ca1cf3d7c77d4e2925ef6f339f78cdc84d4e0cdae841aefc334da07da6edb11` |
| [include/battle.h](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/include/battle.h) | `8ef0355f2345592094c82cfde6641644a6b7157012104736416f8c05f34f0685` |
| [data/battle_ai_scripts.s](https://github.com/pret/pokeemerald/blob/731ad5bfd6e6f265508d0efcca0ba42f9dcf5881/data/battle_ai_scripts.s) | `f6d545de4fdec89b1844aae93b8d844e691b8f14773c1e84ecea1c2e2ce4bf2c` |

### Direct source locations

- MZM `src/samus.c`: `SamusSetMidAir` line 1679; slope adjustment 2719; update order 2770; jump edge check 3364; acceleration 3545; midair release cut 4503; velocity/position integration 6737. Constants: `include/constants/samus.h` lines 317–338; `include/types.h` line 48; `include/macros.h` line 377. Equipment struct: `include/structs/samus.h` line 16; status toggle implementation `src/menus/status_screen.c` line 3522.
- Emerald setup/scoring `src/battle_ai_script_commands.c`: 312, 396, 703. `include/battle.h` line 181 declares signed-byte scores. Switch reasons `src/battle_ai_switch_items.c` 429; action precedence 528; item rules 808. Weather callbacks `src/field_weather.c` 85 and transitions 183–244; map header import `src/field_weather_effect.c` 2522; battle weather mapping `src/battle_util.c` 2479. Weather constants include separate coordinate-event identifiers; those IDs are not a universal one-to-one mapping.

## Exact canonical component snapshots

These blocks are copied byte-for-byte from the current YAML component slices. They are evidence input, not implementation instructions or a declaration of semantic completeness.

### metroid-zero-mission

Canonical file SHA-256: `05a22db180dfb04d67d9da543bef9e58f0381008daaf190f54ee86f4af5aa52b`.

Component `ground_locomotion`, canonical start line 665:

```yaml
- id: ground_locomotion
  facet: movement_physics
  label: Ground run with linear acceleration, slope scaling and skid
  summary: Holding a direction adds a constant acceleration until a speed cap; releasing stops instantly (pose change
    to standing) except while speed-boosting, which enters a skid that decelerates linearly. On slopes the applied
    velocity is scaled down uphill (steep x0.6, slight x0.8) and clamped to 5 px/frame otherwise. Running never
    reverses velocity sign within a frame (clamped at 0). Physics constants are rewritten every frame from a normal
    or a liquid-halved set.
  instantiates:
  - concept: movement_physics.locomotion.accel_to_cap_run
  - concept: movement_physics.locomotion.slope_speed_modifier
  - concept: movement_physics.locomotion.skid_stop
  reads:
  - input.buttons.held
  - player.facing
  - player.velocity.x
  - player.slope
  - physics.slowed_by_liquid
  writes:
  - player.velocity.x
  - player.position.x
  - player.pose
  params:
    run_acceleration:
      value: 0.25
      unit: px/frame^2
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_X_ACCELERATION
        note: 8 vel units
        confidence: 0.95
    run_speed_cap:
      value: 3.0
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_X_VELOCITY_CAP
        note: 96 vel units
        confidence: 0.95
    frames_to_top_speed:
      value: 12
      unit: frames (derived 96/8)
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusApplyXAcceleration
        confidence: 0.85
    slope_uphill_steep_factor:
      value: 0.6
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusChangeVelocityOnSlope
        confidence: 0.95
    slope_uphill_slight_factor:
      value: 0.8
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusChangeVelocityOnSlope
        confidence: 0.95
    slope_other_clamp:
      value: 5.0
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusChangeVelocityOnSlope
        note: +-0xA0 vel units
        confidence: 0.95
    skid_deceleration:
      value: 0.3125
      unit: px/frame^2
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusSkidding
        note: SUB_PIXEL_TO_VELOCITY(1.25) = 10 vel units
        confidence: 0.95
  invariants:
  - Ground X displacement uses slope-adjusted velocity; airborne X uses raw velocity.
  - Releasing direction while not speed-boosting transitions to standing (no friction slide).
  relations:
  - type: modulates
    target: speed_booster
  - type: variant_of
    target: liquid_physics
    note: same code path with halved constants
  evidence:
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusRunning
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusUpdatePhysics
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusUpdateVelocityPosition
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusSkidding
    confidence: 0.95
```

Component `jump_and_gravity`, canonical start line 761:

```yaml
- id: jump_and_gravity
  facet: movement_physics
  label: Fixed-impulse jump with release-to-cut variable height and asymmetric speed caps
  summary: 'Pressing A sets an upward velocity chosen by equipment (normal, High Jump, suitless). Gravity subtracts
    a constant each frame while airborne. Releasing A while rising zeroes vertical velocity instantly (hard cut,
    not damped). Displacement is clamped separately from velocity: max 6 px/frame up and 4 px/frame down, so the
    High Jump impulse (7.25 px/frame) spends its first frames at the cap. No coyote time or jump buffer was found:
    jump is only read on the frame A is newly pressed in a grounded pose.'
  instantiates:
  - concept: movement_physics.jump.variable_height
  - concept: movement_physics.jump.fixed_impulse_gravity_arc
  - concept: movement_physics.gravity.terminal_velocity
  reads:
  - input.buttons.pressed.a
  - input.buttons.held.a
  - equipment.active.high_jump
  - equipment.suit_type
  - physics.slowed_by_liquid
  writes:
  - player.velocity.y
  - player.position.y
  - player.pose
  params:
    gravity:
      value: 0.3125
      unit: px/frame^2
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_Y_ACCELERATION
        note: 10 vel units/frame
        confidence: 0.95
    jump_velocity_normal:
      value: 6.0
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_LOW_JUMP_VELOCITY
        note: 192 vel units
        confidence: 0.95
    jump_velocity_high_jump:
      value: 7.25
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_HIGH_JUMP_VELOCITY
        note: 232 vel units
        confidence: 0.95
    jump_velocity_suitless:
      value: 6.625
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_SUITLESS_JUMP_VELOCITY
        note: 212 vel units
        confidence: 0.95
    rise_displacement_cap:
      value: 6.0
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_Y_POSITIVE_VELOCITY_CAP
        note: '192'
        confidence: 0.95
    fall_terminal_velocity:
      value: 4.0
      unit: px/frame
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SAMUS_Y_NEGATIVE_VELOCITY_CAP
        note: 128; gravity stops accumulating below -231
        confidence: 0.95
    apex_height_normal:
      value: 58.75
      unit: px (~3.7 blocks, 20 frames to apex)
      evidence:
      - kind: derived
        ref: mzm:src/samus.c:SamusUpdateVelocityPosition
        note: Positive-velocity recurrence rechecked by Codex; sums (min(v,192) >> 3)/4 px while v starts at 192 and decreases by 10 per update. No collision or early jump release simulated.
        inputs:
        - mzm:src/samus.c:SamusUpdateVelocityPosition
        - mzm:include/constants/samus.h:SAMUS_LOW_JUMP_VELOCITY=192
        - mzm:include/constants/samus.h:SAMUS_Y_ACCELERATION=10
        - mzm:include/constants/samus.h:SAMUS_Y_POSITIVE_VELOCITY_CAP=192
        - mzm:include/types.h:SUB_PIXEL_RATIO=4
        - mzm:include/macros.h:DIV_SHIFT
        confidence: 0.75
    apex_height_high_jump:
      value: 82.75
      unit: px (~5.2 blocks, 24 frames to apex)
      evidence:
      - kind: derived
        ref: mzm:src/samus.c:SamusUpdateVelocityPosition
        note: Positive-velocity recurrence rechecked by Codex with initial velocity 232; displacement cap remains 192. No collision or early jump release simulated.
        inputs:
        - mzm:src/samus.c:SamusUpdateVelocityPosition
        - mzm:include/constants/samus.h:SAMUS_HIGH_JUMP_VELOCITY=232
        - mzm:include/constants/samus.h:SAMUS_Y_ACCELERATION=10
        - mzm:include/constants/samus.h:SAMUS_Y_POSITIVE_VELOCITY_CAP=192
        - mzm:include/types.h:SUB_PIXEL_RATIO=4
        - mzm:include/macros.h:DIV_SHIFT
        confidence: 0.75
    jump_cut:
      value: 0
      unit: vertical velocity set on A release while rising (px/frame)
      evidence:
      - kind: decomp_source
        ref: mzm:src/samus.c:SamusMidAir
        confidence: 0.95
  invariants:
  - Upward displacement per frame <= 6 px and downward <= 4 px regardless of stored velocity.
  - Jump impulse is applied only on a newly-pressed A (gChangedInput), never on hold.
  relations:
  - type: gated_by
    target: ability_gating_graph
    note: High Jump raises impulse
  - type: modulates
    target: air_control_and_spin
  evidence:
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusSetMidAir
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusMidAir
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusUpdateVelocityPosition
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusCheckJumping
    confidence: 0.9
```

Component `ability_gating_graph`, canonical start line 2444:

```yaml
- id: ability_gating_graph
  facet: progression
  label: Equipment-flag ability gating (owned vs active)
  summary: 'Abilities are two bitfields - beams/bombs and suit/misc (High Jump, Speed Booster, Space Jump, Screw
    Attack, Varia, Gravity, Morph Ball, Power Grip) - each with an owned and an active copy toggled on the status
    screen. Gates are checked in movement/weapon code: Morph Ball -> tunnels and bombs; Bombs -> bomb blocks and
    bomb jumps (IBJ); Missiles/Super/PB -> typed hatches and blocks; Speed Booster -> speed blocks and shinespark;
    Screw -> screw blocks; Power Grip -> ledges; High Jump -> taller jumps and ball jump; Varia and Gravity -> heat/lava/liquid
    traversal; Space Jump -> unlimited height. Areas are revisited as new abilities arrive.'
  instantiates:
  - concept: progression.gating.ability_gating
  - concept: progression.structure.backtracking
  - concept: progression.structure.interconnected_areas
  reads:
  - equipment.owned.*
  - equipment.active.*
  writes:
  - equipment.owned.*
  - equipment.active.*
  params:
    misc_abilities:
      value:
      - high_jump
      - speedbooster
      - space_jump
      - screw_attack
      - varia_suit
      - gravity_suit
      - morph_ball
      - power_grip
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:SuitMiscFlags
        confidence: 0.95
    beam_bomb_abilities:
      value:
      - long_beam
      - ice_beam
      - wave_beam
      - plasma_beam
      - charge_beam
      - bombs
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/samus.h:BeamBombFlags
        confidence: 0.95
    areas:
      value:
      - brinstar
      - kraid
      - norfair
      - ridley
      - tourian
      - crateria
      - chozodia
      evidence:
      - kind: decomp_source
        ref: mzm:include/constants/connection.h:Area
        confidence: 0.95
  invariants:
  - Gameplay checks read the active bitfield, not the owned one.
  - Abilities are never lost except by the suitless state change.
  relations:
  - type: requires
    target: typed_locks
  - type: requires
    target: chozo_statue_items_and_hints
  evidence:
  - kind: decomp_source
    ref: mzm:include/structs/samus.h:struct Equipment
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusCheckCollisions (SMF_POWER_GRIP)
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/samus.c:SamusRolling (SMF_HIGH_JUMP)
    confidence: 0.95
  - kind: decomp_source
    ref: mzm:src/menus/status_screen.c:StatusScreenToggleItem
    confidence: 0.75
  - kind: llm_knowledge
    ref: general area layout/backtracking order of Zebes
    confidence: 0.5
```

### pokemon-emerald-version

Canonical file SHA-256: `4ce2f6b5fcb978c93542f38223aa50ac1e4aa8ac8770ea0aaba31ddc4575d0a5`.

Component `overworld_weather_effects`, canonical start line 668:

```yaml
- id: overworld_weather_effects
  facet: rendering
  label: Map weather with particle sprites, palette colour maps and blend layers
  summary: 'Each map header names a weather; coordinate events can change it. Weather is a callback set (init, main,
    finish) per type: rain/thunderstorm/downpour spawn rain sprites and darken palettes via colour-map index 3 (thunder
    adds flashes), snow and volcanic ash spawn particles, fog and sandstorm draw a semi-transparent BG/sprite layer,
    shade darkens, drought brightens with a pulsing BLDY lighten and dedicated colour tables, underwater bubbles
    rise. Route 119/123 cycle weathers and the "abnormal" weather alternates rain and drought during the Groudon/Kyogre
    crisis. Rain/sandstorm/drought carry into battle as battle weather.'
  instantiates:
  - concept: mechanics.environment.weather_states
  - concept: rendering.palette.runtime_palette_effects
  - concept: rendering.blending.alpha_layer_transparency
    weight: 0.5
  reads:
  - map.header.weather
  - weather.current
  writes:
  - weather.current
  - palette.faded
  - io.bldcnt
  - io.bldalpha
  - io.bldy
  - sprites[weather]
  params:
    weather_types:
      value: 16
      unit: weather ids 0-15 (+2 cycling route ids); SNOW, FOG_DIAGONAL, UNDERWATER marked unused
      evidence:
      - kind: decomp_source
        ref: pokeemerald:include/constants/weather.h
        confidence: 0.95
    rain_color_map_index:
      value: 3
      unit: darker colour-map step (0 = normal)
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/field_weather_effect.c (targetColorMapIndex = 3 in rain/thunder/shade inits)
        confidence: 0.7
  relations:
  - type: modulates
    target: battle_weather
    condition: rain, thunderstorm, downpour, sandstorm or drought map weather at battle start
  - type: part_of
    target: metatile_map_renderer
  evidence:
  - kind: decomp_source
    ref: pokeemerald:src/field_weather.c:sWeatherFuncs
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:src/field_weather.c:ApplyDroughtColorMapWithBlend
    confidence: 0.8
  - kind: decomp_source
    ref: pokeemerald:src/field_weather_effect.c:UpdateDroughtBlend (BLDCNT lighten + BLDY ramp)
    confidence: 0.8
  - kind: decomp_source
    ref: pokeemerald:src/battle_util.c (GetCurrentWeather switch at battle start)
    confidence: 0.9
```

Component `trainer_ai_move_scoring`, canonical start line 2900:

```yaml
- id: trainer_ai_move_scoring
  facet: ai
  label: Flag-selected script modules that score each move, then pick the max
  summary: 'Each opponent turn every usable move starts at score 100 (unusable moves 0). The trainer''s AI flags select
    script modules from a 32-entry table, run in bit order over every move; each module adds or subtracts points via
    conditionals over the real battle state (the AI sees the player''s exact HP, types, ability and last move). After
    all modules the AI picks uniformly among the moves with the highest score. Damage queries (can this KO? is this the
    strongest move?) re-run the damage formula with a random factor pre-rolled per move at setup. Special flags replace
    move choice with an action: roamers flee unless trapped, Safari mons flee or watch, and the first-battle Zigzagoon
    flees at <=20 HP. Gym leaders and Elite Four use BAD_MOVE+TRY_TO_FAINT+VIABILITY (+SETUP_FIRST_TURN for some);
    most route trainers only CHECK_BAD_MOVE.'
  instantiates:
  - concept: ai.decision.utility_scoring_scripts
  reads:
  - battlers[*].hp
  - battlers[*].types
  - battlers[*].ability
  - battlers[*].status
  - battle.weather
  - battle.turn_count
  - ai.move_history
  - trainer.ai_flags
  writes:
  - ai.scores[4]
  - ai.chosen_move
  - ai.action
  params:
    base_score:
      value: 100
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_script_commands.c:BattleAI_SetupAIData
        confidence: 0.95
    simulated_damage_roll:
      value: 85-100
      unit: percent, one roll per move per turn (100 - Random()%16)
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_script_commands.c:BattleAI_SetupAIData (simulatedRNG)
        confidence: 0.95
    random_branch_scale:
      value: 256
      unit: if_random_less_than N fires with probability N/256
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_script_commands.c:Cmd_if_random_less_than
        confidence: 0.95
    score_floor:
      value: 0
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_script_commands.c:Cmd_score
        confidence: 0.95
  tables:
    ai_modules:
      description: AI flag modules (bit order) and their main scoring rules, paraphrased from data/battle_ai_scripts.s.
      columns:
      - bit
      - module
      - rules
      rows:
      - [0, CHECK_BAD_MOVE, '-10 if target immune by type, Levitate, Wonder Guard (non-SE), Soundproof; -12 if absorbed
          by Volt/Water Absorb/Flash Fire; per-effect penalties for redundant status, maxed stats, failing setup']
      - [1, TRY_TO_FAINT, '+4 if the move can KO (+2 more if it is a priority move, not for Explosion); -1 if not the
          strongest damaging move; +2 for 4x effective with 176/256 chance']
      - [2, CHECK_VIABILITY, 'per-effect heuristics on HP, speed order, stats and status (largest module)']
      - [3, SETUP_FIRST_TURN, '+2 (176/256) for stat-change moves on turn 0']
      - [4, RISKY, '+2 (128/256) for sleep, Explosion, OHKO, high-crit, confuse, Metronome, Counter, Destiny Bond, Swagger,
          Attract, Present...']
      - [5, PREFER_POWER_EXTREMES, '+2 (156/256) for non-damaging or ignored-power moves']
      - [6, PREFER_BATON_PASS, 'favour setup then Baton Pass; +5 setup on turn 0, -10 below 60% HP']
      - [7, DOUBLE_BATTLE, 'auto-added in doubles: avoid hitting partner, account for Earthquake, Helping Hand, Lightning Rod/Flash
          Fire partners']
      - [8, HP_AWARE, '-2 (206/256) for effects listed as poor at the user''s or target''s HP band (>70%, 30-70%, <30%)']
      - [9, TRY_SUNNY_DAY_START, '+5 Sunny Day on the user''s first turn']
      - [29, ROAMING, flee unless wrapped/trapped/Shadow Tag/Arena Trap (Levitate ignores Arena Trap)]
      - [30, SAFARI, random flee else watch]
      - [31, FIRST_BATTLE, flee when target HP <= 20]
      evidence:
      - kind: decomp_source
        ref: pokeemerald:data/battle_ai_scripts.s:gBattleAI_ScriptsTable, AI_CheckBadMove, AI_TryToFaint, AI_SetupFirstTurn,
          AI_Risky, AI_PreferPowerExtremes, AI_PreferBatonPass, AI_DoubleBattle, AI_HPAware, AI_TrySunnyDayStart, AI_Roaming,
          AI_Safari, AI_FirstBattle
        confidence: 0.9
    trainer_flag_usage:
      description: Count of gTrainers entries per AI flag combination.
      columns:
      - flags
      - trainers
      rows:
      - [CHECK_BAD_MOVE, 640]
      - [CHECK_BAD_MOVE + TRY_TO_FAINT + CHECK_VIABILITY, 173]
      - [none, 16]
      - [CHECK_BAD_MOVE + TRY_TO_FAINT + SETUP_FIRST_TURN, 13]
      - [CHECK_BAD_MOVE + TRY_TO_FAINT, 7]
      - [CHECK_BAD_MOVE + TRY_TO_FAINT + CHECK_VIABILITY + RISKY, 5]
      - [CHECK_BAD_MOVE + TRY_TO_FAINT + CHECK_VIABILITY + SETUP_FIRST_TURN, 1]
      evidence:
      - kind: derived
        ref: grep/uniq of .aiFlags in src/data/trainers.h
        inputs:
        - pokeemerald:src/data/trainers.h
        confidence: 0.9
  invariants:
  - Ties at the top score are broken uniformly at random; scores never go negative.
  - The AI does not simulate critical hits when evaluating damage.
  - Frontier, Trainer Hill, secret-base and e-Reader opponents always use BAD_MOVE + VIABILITY + TRY_TO_FAINT; Battle
    Factory picks flags by streak.
  relations:
  - type: requires
    target: damage_formula
  - type: requires
    target: type_chart
  - type: part_of
    target: battle_engine_core
  - type: modulates
    target: double_battles
    condition: double battles
  evidence:
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_script_commands.c:BattleAI_SetupAIData
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_script_commands.c:ChooseMoveOrAction_Singles
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_script_commands.c:Cmd_get_how_powerful_move_is
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_script_commands.c:Cmd_if_can_faint
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:include/constants/battle_ai.h (AI_SCRIPT_* bits)
    confidence: 0.95
```

Component `trainer_ai_switch_and_items`, canonical start line 3034:

```yaml
- id: trainer_ai_switch_and_items
  facet: ai
  label: Rule-based trainer switching and item use
  summary: 'Before move scoring, trainer AI may switch or use an item. It switches (if another healthy mon exists) when
    Perish Song is about to KO it, when it cannot touch a Wonder Guard foe, when a party mon absorbs the foe''s last move
    type, or to cure a status via Natural Cure; it stays in if it has a super-effective move or raised stats; otherwise
    it may switch to a party mon resistant/immune to the foe''s last move with 1/2 or 1/3 chance. The replacement is the
    mon with the best type matchup against the foe. Trainers carry up to 4 items: Full Restore below 1/4 HP, potions when
    below 1/4 or the heal would not overflow, status cures, X items and Guard Spec on early turns.'
  instantiates:
  - concept: ai.items.situational_item_use
    weight: 0.5
  - concept: ai.decision.rule_based_switching
  reads:
  - battlers[*].hp
  - battlers[*].status
  - battlers[*].stat_stages
  - foe.last_move_type
  - trainer.items
  - enemy_party[*]
  writes:
  - ai.switch_target
  - trainer.items
  params:
    trainer_item_slots:
      value: 4
      evidence:
      - kind: decomp_source
        ref: pokeemerald:include/data.h:struct Trainer (items[MAX_TRAINER_ITEMS])
        confidence: 0.9
    full_restore_threshold:
      value: 0.25
      unit: fraction of max HP
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_switch_items.c:ShouldUseItem (AI_ITEM_FULL_RESTORE)
        confidence: 0.95
    resist_switch_odds:
      value: 1/2 (immune) or 1/3 (resists)
      evidence:
      - kind: decomp_source
        ref: pokeemerald:src/battle_ai_switch_items.c:ShouldSwitch (FindMonWithFlagsAndSuperEffective moduloPercent 2/3)
        confidence: 0.85
  relations:
  - type: part_of
    target: trainer_ai_move_scoring
  evidence:
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_switch_items.c:ShouldSwitch
    confidence: 0.95
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_switch_items.c:AI_TrySwitchOrUseItem
    confidence: 0.9
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_switch_items.c:ShouldUseItem
    confidence: 0.9
  - kind: decomp_source
    ref: pokeemerald:src/battle_ai_switch_items.c:GetMostSuitableMonToSwitchInto
    confidence: 0.7
```
