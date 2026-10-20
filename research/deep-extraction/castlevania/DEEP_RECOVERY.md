# Aria gameplay components recovered from the cartridge

The enemy-defeat reward subsystem is executable composition, beyond an input or
menu helper. `defeat-policy.c` contains the independently reconstructed policy;
`defeat-host.c` is the versioned adapter retaining this exact game's native RNG,
level-up, world query and pickup entities. Both are pinned by `defeat.package.json`.
The actual lethal transition already in the host invokes this recovered policy.
No community-source implementation was used for this recovery.

## Mechanics and composition

On first defeat, the enemy's reward flag commits before mode guards. Ordinary
play records bestiary discovery and grants descriptor XP, optionally scaled by
307/256 and capped at99,999,999. Native level-up runs before probability tests,
so its changed luck is observed correctly. Equipped accessory, signed luck,
already-owned soul count and authored rarity affect the ordered drop tests.

A successful soul request bypasses all other tests. Otherwise item/resource
drops require a suitable world location. One of two items is selected before its
rarity test; discovery is recorded even if native pickup allocation fails. If
both authored items are absent, the currency/MP fallback does not run. There is
at most one spawn request, no retry following allocation failure, and RNG draws
remain ordered rather than pre-sampling a fixed batch. Repeated calls for the
same enemy do nothing. Ordinary despawn must not invoke this transaction.

The two plans change `xp_scale` between1and2. They use exactly the same policy,
host adapter, package and builder. These are reward variants in the complete
original campaign, not newly generated full games or cross-game enemy prefabs.

```
python3 research/deep-extraction/castlevania/qualify_defeat.py \
  --rom 'local/roms/Castlevania - Aria of Sorrow (USA).gba' \
  --out local/re/experiments/my-new-aria-reward-run
```

The runner uses existing tools, makes no model calls or dependency installation,
and caps subprocesses at30s. Its fixed scope is2builds,14,720 instruction cases,
and3cartridges ×6400 emulated frames in isolated fresh state. Failed builds and
runs retain their reports. It never opens the player's saves.

## Recorded evidence

`defeat-qualification.json` pins the full private run and its source/ROM/backend
identities. On the same ARM Mac, clean builds emitted1418bytes and took about
0.14s each; the complete final qualification took6.237s. Queue time is unavailable.
There was no prior component-builder baseline for this subsystem. A first build
failed on an implicit compiler memory-clear dependency; that failure remains in
`local/composition-builds/aria-defeat-parity-01/`. The corrected adapter has no
unresolved runtime helpers. The second qualification changed ledger extents from
8to4words per128species plane and repeated the affected checks.

14,720 cases compare actual original and emitted Thumb execution across115
reviewed enemy descriptors and128 boundary configurations. They compare the
campaign state, actor bytes, exact spawn arguments, RNG draw count and level
notification. Deterministic service boundaries supply RNG/tile/level return and
intercept spawn allocation; actual native soul ownership, equipment and modulo
helpers execute. Passing counts include4048soul,114item,44currency and28MP
requests. This local comparison does not claim all retained-service internals
were independently decompiled.

The three actual recorded gameplay runs use all real native services. Identical
controls defeat a Zombie: original/parity XP0→1; alternate plan XP0→2. Original
and parity sampled traces and encoded videos are identical. Evidence is in
`local/re/experiments/20261016-aria-defeat-qualification-02/play-{original,parity,double-xp}/`.
This proves the native call path and plan-selected reward behavior, not the
entire campaign, rare drop acquisition or every enemy.

## Next dependencies

The casting transaction now has an assembled native adapter in `cast-host.c`.
`ability.package.json` combines it with the independently reconstructed starter
bone and moving contact-partner lifecycle in `bone-policy.c`, and both ability
plans compose this package with the separate defeat-reward package.

The original bone starts at horizontal speed ±4 pixels/update and vertical speed
−1.125, with gravity +0.125 and a speed cap of8. Exact quantized sine lookup drives
its spin/contact offset. Successful initialization owns an affine transform and a
second tracked contact entity. Allocation failure clears the exact cast slot;
already-spent MP is not refunded. Each entity owns its own count decrement and
slot release. Terrain contact enters a32-update linger; hit-liveness loss and
viewport exit schedule destruction. A second plan selects16-update linger with
exactly the same sources. The apparent `0x0806d128` collision helper is actually
viewport culling; enemy contact and terrain remain separate.

`ability-qualification.json` records2560 original/emitted projectile cases plus
5376 new native-casting-adapter cases against the previously original-qualified
portable policy. The final6.745s bounded run built both whole cartridges and
recorded3×6440 native frames. Actual MP debit, two-entity ownership, projectile
kill→XP, and final count/slot cleanup all passed. Original and parity gameplay
traces and videos were identical. The alternate IR plan visibly changes lifetime.
Artifacts are in `local/re/experiments/20261016-aria-ability-qualification-01/`;
`play-parity/playthrough.mp4` is actual emulator output. There is no full-campaign
or other-ability qualification. Retained graphics/contact/damage services and a
future cross-game actor adapter remain explicit dependencies.

The next chain is soul pickup homing/contact→inventory acquisition/equip
availability, followed by fuller enemy AI and ordinary attack/jump pose rules.
Level growth and damage records in the older ontology remain historical source
leads until independent ROM qualification replaces their evidence.

The backend validates declared actor layout and retained-service identities;
it does not yet prove all C global-memory effects from source. The IR separately
declares progression write authority. A cross-game host must implement these
services and state mappings explicitly; original ROM addresses are not portable
behavior tokens.

## Reward acquisition checkpoint

`acquisition.package.json` adds original-recovered soul homing/lifetime and the
collection transaction, plus a portable, explicitly mapped nibble inventory. It
composes beside casting and enemy rewards in `acquisition-parity.plan.json`.
The new original/emitted4096case comparison covers full9stack rejection,
collection rollback, room/event persistence, new versus duplicate soul handling,
item/gold caps, homing acceleration and expiry. Native two-bank soul behavior is
preserved, including the ability category whose two banks alias and whose count
therefore doubles. This is a semantic contract, not an assumed invariant.

The focused qualification took1.400s and produced an identical native compatibility
trace/video. **A real rare-soul acquisition was not observed.** A separately bounded
32attempt source-ROM route search took7.921s; all attempts killed the Zombie and
none changed soul ownership. Its authored rarity is180, giving about6/1472base
soul probability before accessory/luck effects. The search was stopped at its
explicit limit. This checkpoint is local equivalence, not a fully gameplay-qualified
acquisition prefab. The unsatisfied witness is retained in
`acquisition-qualification.json`; no player-facing game registration is requested.
