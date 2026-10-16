# Metroid systems inside Sonic Advance: native integration investigation

Date: 2026-10-16. Status: source investigation; no new game, baseline build, or gameplay qualification claimed.

## Intended game

The submitted `gameverse-mashup-request.json` selects **Sonic Advance as the whole-world/campaign foundation**, with Zero Mission movement, real-time combat, equipment, enemy ecology, hazards and ability progression. Its eight choices are bundles of source components, rather than eight independently linkable libraries.

Both parents already use side-view worlds. The exported generic `view_conversion` note does not require a perspective conversion. The generic paused tactical encounter note does not fit this request: beam/projectile/enemy combat should run in the Sonic field. This is a different candidate from the earlier Metroid/Pokémon build. The original brief remains untouched.

**Subsequent human clarification:** keep Sonic momentum on loops and ramps. The accepted design is a hybrid controller: retain Sonic ground angle, tangent velocity, slope gravity, loop contact and authored launch impulses; use compatible MZM controls/physics elsewhere. Do not flatten loops or impose MZM's ordinary speed cap across the campaign.

## Main finding: plausible source seams, baseline revision gap

`local/decomps/sa2` is the **Sonic Advance Trilogy** project, despite its directory name. Its SA1 target is real Sonic Advance 1, not Advance 2. It has 173 SA1 C files / 82,301 lines plus shared engine sources. Those counts describe source inventory, not matching or port completeness.

| Parent | Requested/indexed ROM | Pinned source | Current fidelity |
| --- | --- | --- | --- |
| Sonic Advance | USA, ASOE, maker 78, version 0; SHA1 `d842afa7dd1e84de08addb94a51506f1bcafd551` | SAT-R/sa2 `393357f7c9d46b5c10b6c41a57b80fe3b58f3c8d` | SA1 build configuration hard-selects Europe, ASOP/maker 6W; published baseline SHA1 `eb00f101af23d728075ac2117e27ecd8a4b4c3e9`. Exact USA baseline is **not established**. |
| Metroid: Zero Mission | USA; SHA1 `5de8536afe1f0078ee6fe1089f890e8c7aa0a6e8` | `local/decomps/mzm` `9caaefc0ee570f3399d86acf140fdeada9692836` | Source components available; separate existing build receipts establish its baseline, not Sonic compatibility. |

The SA1 source still requires `baserom_sa1.gba` for fixed-offset data. That file is absent from this checkout. A static scan of `data/sa1`, `src/game/sa1`, `src/game/shared`, `src/data` and `sound/sa1` finds 259 literal directives across 16 files covering 702,548 distinct byte offsets. This is an inventory, not a measurement of active linker input or all generated asset dependencies. Using the USA cart at those Europe offsets would produce incorrect assets/data. Changing the header or setting `GAME_REGION=USA` cannot repair that.

The immediate paths are (a) establish an exact USA source/data target against the indexed cart, or (b) explicitly select a verified Europe baseline if a matching local cart is available. This is a baseline gap to solve, not proof the USA target is impossible. No alternate ROM was downloaded, substituted, or searched for. No compiler/bootstrap/build was launched: a blind build against incorrect asset offsets would not certify the requested baseline. Build duration is unavailable; no numeric budget or speed claim is invented.

The indexed local USA file was read and independently SHA1-verified. Its idle-animation table signature `{0,99,199,298}` occurs exactly once, at `0x4A6F04`; the previously source-mapped Europe position is `0x4ADF08`, a difference of `0x7004`. The bytes at the Europe offset in the USA cart are `00 00 ba dc 00 87 a9 cb`, not that table. This proves a substantive data-layout difference beyond the ROM header. A single anchor does **not** justify rebasing every data section by `−0x7004`.

SA1 has 153 named assembly fallback `.inc` files under `asm/non_matching/game/sa1`; its shared player source has four `NONMATCH` wrappers and Sonic's SA1-specific player source has none. These are file/wrapper counts, not a function coverage percentage. Normal matching builds can retain those assembly bodies; modifying an assembly-backed function requires intentionally enabling/replacing its C body and verifying behavior. The repo is substantial editable source with some assembly/data dependencies, rather than an opaque whole-ROM loader.

### Bounded next USA-baseline attempt

Use only the known local USA cart. First create a new isolated workspace and a machine-readable section map. Resolve each referenced Europe blob/table using structural signatures and pointer/table constraints in USA, starting with the named player, stage, entity and animation tables. Reject ambiguous matches. Extract blobs from the USA cart at verified USA offsets; preserve their SHA256 provenance. Fixed embedded function/data pointers require a USA linker map or relocation, not merely moving bytes. Region-dependent language/menu assets and code must be identified explicitly.

Then install the pinned **SAT-R/agbcc** toolchain (the repo requests `-fhex-asm` and SA1 `-fprologue-bugfix`; the unrelated MZM compiler is not presumed compatible), retain the original SA1 link ordering and attempt one USA baseline build with at most four jobs and one bounded build/repair attempt. Expected cold cost is several minutes including compiler setup, but this is an estimate, not a measurement. Record exact inputs, unresolved sections and compiler/build timing separately. Compare SHA1 to `d842afa7...`, or retain byte-diff sections and stop calling it matching. Do not let “boots in an emulator” substitute for baseline fidelity. This next attempt is proposed research, not work already executed or a commitment to a full regional decompilation.

Evidence: [pinned source README](https://github.com/SAT-R/sa2/blob/393357f7c9d46b5c10b6c41a57b80fe3b58f3c8d/README.md), `config.mk:68–87`, `sa1.sha1`, `data/sa1/data_0_3.s`, and existing `ontology/games/sonic-advance.yaml` region caveat. Remote fetch was unavailable during this investigation; findings come from the pinned local checkout.

## Native integration map

| Bundle | Actual source seam | Reuse and required bridge |
| --- | --- | --- |
| Movement | SA1 `Task_PlayerMain` → `Player_Sonic_80473AC`; `Player_8044F7C`, `Player_TryJump`, `Player_8044670`, `Player_AirInputControls` | Add a native Metroid player update at the SA1 character dispatch. Port exact extracted MZM acceleration, jump/release and displacement order; preserve Sonic terrain/contact layers and stage tasks. Do not hook the SA2 callback-only code path. |
| Collision and camera | Sonic `terrain_collision.c`, `gRefCollision`, `SA2_LABEL(sub_801F07C)`, `SA2_LABEL(sub_801E4E4)`, `InitCamera`, `UpdateCamera`, `RenderMetatileLayers` | Sonic remains owner of terrain geometry, tile streaming, camera bounds and HBlank parallax. MZM contact queries need an explicit Sonic collision adapter. Borrow MZM tracking behavior through this camera, rather than installing a second camera/VRAM owner. |
| Beam stacking and ammunition | MZM `SamusAimCannon`, `SamusCheckFireBeamMissile`, `SamusCheckNewProjectile`, `ProjectileProcess*`, `ProjectileMove`, `ProjectileDealDamage`; `Equipment`, `WeaponInfo`, projectile data | Extract real projectile rules/tables and equipment flags; adapt collision, entity hit lookup, particles, audio and sprite drawing to Sonic tasks. Direction/muzzle location must come from the new player state. Render through Sonic `Sprite`/VRAM allocator; copying MZM OAM/DMA writers into Sonic is unsafe. |
| Damage and body attacks | Sonic `Coll_DamagePlayer`, `Coll_Player_Enemy_Attack`, boss collision helpers; MZM `SpriteUtilTakeDamageFromSprite`, `SpriteUtilSpriteTakeDamageFromSamusContact` | Make one damage authority using MZM energy and invulnerability rules. Sonic's current damage path scatters rings or kills with zero rings; it must be deliberately bypassed for this mode. Rings may remain score/collectibles. Bosses have separate hit paths and need explicit projectile hooks. |
| Ecology | MZM `Zoomer`, `Ripper`, `SpacePirate`, `Kraid`; `sPrimarySpriteStats`; Sonic `CreateStageEntitiesManager`, `CreateEntity_Rhinotank` pattern | Port actual AI state machines plus stats into per-entity Sonic task state. Adapt MZM `gCurrentSprite` context, clipdata probes, freeze/stun/death and animation. Supply explicit stage spawn recipes; merely adding beam fire to existing Badniks does not satisfy Metroid ecology. |
| Energy and drops | MZM `Equipment`, `SpriteUtilDetermineEnemyDrop`, `SpriteUtilSpriteDeath`; Sonic task/collectible lifecycle | Port selection rules and resource caps, translating random source and drop entities. Do not let camera despawn grant drops or allow repeated respawn to duplicate permanent rewards. |
| Progression | Sonic `SaveGame`, `WriteSaveGame`, stage goals/checkpoints/breakable walls; MZM equipment flags, typed destruction actions, Chozo/item logic | Add a versioned candidate save extension and stage/event ownership. Place actual upgrades and typed barriers in the Sonic campaign. Never hide new flags in unknown save padding. Existing Sonic acts are not an interconnected Zebes graph; backtracking/return links and ability-consumer routes need authored additions. |
| Atmosphere/story | Sonic per-zone backgrounds/HBlank callbacks, stage transitions, ending/emerald rules; MZM story/cutscene/escape source | Keep Sonic campaign transitions and render pipeline; introduce explicit region/event changes. Alien ruins, discovery/escape beats and music are authored campaign changes, not automatically produced by physics replacement. Asset provenance must satisfy the brief's `original_or_permitted_assets` constraint. Availability of a local ROM does not itself resolve that constraint. |

## Exact units and update-order bridge

Sonic `Player` (`include/game/shared/stage/player.h`) has signed 32-bit 24.8 `qWorldX/Y`, signed 16-bit `qSpeedAirX/Y` and scalar `qSpeedGround`, a surface `rotation`, collision `layer`, `stoodObj` and move-state flags. `global.h` defines `Q(n)=n*256`; +Y is downward. Terrain and camera should continue to consume that representation.

MZM `SamusData` has unsigned 16-bit quarter-pixel positions (`SUB_PIXEL_RATIO=4`), signed 16-bit velocities, and +Y velocity upward. Its `VELOCITY_TO_SUB_PIXEL(v)` is **arithmetic shift by 3**, not Q8.8-to-pixel conversion. Therefore:

```
MZM quarter-pixel displacement d -> Sonic displacement d * 64
MZM velocity v -> nominal Sonic velocity v * 8
MZM upward y velocity v -> nominal Sonic y velocity -v * 8
```

Exact displacement must use `(v >> 3) * 64`, with the sign applied after MZM's shift. Multiplying raw velocity by eight and integrating directly changes quantization, especially negative motion. Preserve native signed casts, cap comparisons, jump-cut ordering and pre-gravity displacement. Do not use a full Sonic stage position as an unbounded `u16` MZM coordinate; keep Sonic global coordinates and a checked local origin for MZM contexts/probes. Rendering origins also differ: Sonic player position is sprite-centered with `spriteOffsetY` to the ground, while MZM foot/hitbox rules need an explicit anchor conversion.

From actual MZM constants: acceleration 8 → nominal 0.25 px/frame², ground cap 96 → 3 px/frame, air cap 64 → 2 px/frame, gravity 10 → nominal 0.3125 px/frame²; actual movement remains quantized. `SamusUpdateVelocityPosition` caps displacement using old vertical velocity, then updates velocity, then applies the displacement. Ground running suppresses a displacement opposing the facing direction. `SamusApplyXAcceleration` also has asymmetric signed-cast behavior worth retaining if the claim is exact reuse.

## Sonic geometry is the consequential adaptation

Sonic's scalar ground speed is projected through the surface tangent using sin/cos. Existing steep-surface detachment checks include a 1.875 px/frame threshold. More concretely, `Task_MiniLoop_StartBoost` writes **+9 px/frame**, and `Task_MiniLoop_Exit` writes **−7.25 px/frame**. Those are real authored Sonic world rules, far above MZM's ordinary 3 px/frame ground cap.

A literal cap replacement every frame would erase those impulses and can strand the player. A faithful Sonic campaign with untouched routes cannot be assumed reachable under literal Samus physics. The **human-selected bridge** is Metroid control/acceleration/jump behavior during normal traversal while preserving Sonic momentum on ramps/loops. Retain Sonic's tangent projection, slope gravity, contact/layer changes, detach logic and tagged external impulses. On entry to a slope, convert the current world velocity into the surface tangent without inventing energy; while attached, let Sonic collision and ground-speed integration own motion. On departure, convert tangent speed back into air X/Y and preserve that excess speed; MZM controls may steer/brake gradually, but ordinary caps must not clamp inherited launch speed on the next frame. Springs/platform overrides and reversed-gravity states need their own explicit ownership tags. Use contact/interaction state to switch authority, with a short documented hysteresis to avoid alternating controllers at a slope edge; a numeric angle threshold is still to be established from route evidence.

Jump direction during a loop follows the Sonic surface normal and tangent momentum; on ordinary floor it can use MZM jump initiation and release. Decide separately which MZM wall-jump/ledge-grab actions are enabled when Sonic terrain presents a valid side contact. Do not confuse rolling/spindash with Morph Ball or automatically map a ring to an energy pickup. Speed Booster progression may add abilities, but it must not disable already-required Sonic momentum routes. Ability gates need explicit new consumers and reachable unlocks before required routes.

For comparison, literal Metroid movement everywhere would require bypasses/geometry edits for speed-dependent loops, long launches, collapsing routes and boss arenas. That alternative was investigated and is **not the selected direction**. Neither approach has been gameplay-qualified here.

MZM liquid behavior reads typed clipdata (water/lava/acids) and Gravity Suit activation. Sonic has zone water/underwater physics and drowning logic, rather than the same hazard map. The adapter must assign hazard/material metadata to actual Sonic areas, route heat/liquid damage and suit immunity through one authority, and suppress conflicting native water logic. Parallax is rendering; it does not create liquid mechanics.

## Implementable sequence and acceptance evidence

1. Establish the foundation: verify cart SHA1, source commit, asset offsets, compiler and byte-identical baseline. Record failure rather than publishing a bad build. Use one isolated workspace; first build cost is unknown until measured, so do not begin a broad matrix.
2. Compile actual extracted MZM movement functions/constants with a small explicit host API for input, contact probes, world position and equipment. Keep Sonic tasks, maps, collision and camera. Qualify flat acceleration/reversal, early jump release, slopes, a loop and spring interactions against source-linked traces.
3. Add MZM weapon/equipment/damage/drop systems through native tasks and entity hit interfaces. Qualify ground/air aiming, cooldown/ammo, stacked beams, energy, invulnerability, enemy death and camera despawn. Record screenshots/MP4 from the **candidate ROM**, with SHA256 and input trace.
4. Integrate enemy ecology and authored upgrades/gates across retained acts, then qualify critical routes, staged bosses, save/restore and campaign completion. Kraid needs a suitable authored arena, multipart sprite budget, collision and exit event; it cannot be dropped into an arbitrary scrolling stretch merely by naming its AI function.
5. Register the compiled ROM through the normal GBA catalog and Play adapter with an independent game/save identity. Preserve existing accepted FireRed and other candidate progress. No web-engine surrogate and no hidden prototype page.

These are bounded stages of the whole-game integration, not a proposal to deliver only a one-room demo. Initial stage smoke evidence cannot establish campaign completion. Current outcome is an actionable source plan with a verified region/data blocker, not a compatibility certificate.

The accompanying `sonic-metroid-source-evidence.json` pins source hashes and symbol locations so later extraction/build agents can resolve actual code rather than reconstructing mechanics from prose. No game source, compiler, UI, ROM or accepted player save was modified during this investigation.
