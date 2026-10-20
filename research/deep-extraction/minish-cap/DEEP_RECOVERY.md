# Minish Cap: an assemblable sword action controller

The USA cartridge's complete nine-action sword controller is independently recovered in `sword-policy.c`. It is compiled through the shared component builder into the original cartridge. `sword-parity.plan.json` preserves the skill-conditioned charge policy; `sword-fast-charge.plan.json` selects a faster charge using the same package and C. Neither plan rewrites a hand-edited game source tree.

The recovery covers initialization and swing, uncharged windup, charged hold, spin release, repeated greatspin, airborne attack, special transition, dash thrust and cleanup. It owns item state, timer and animation flags, skill gates, the player's action masks, technique and movement authority, requests for sword/beam actors and exact ownership cleanup. Native allocation, input, animation, movement and collision services are explicit dependencies. The sword actor's contact damage internals and cross-game player adapter are not yet extracted here.

## Evidence and practical limits

`sword-qualification.json` pins the original ROM, code ranges, source, build receipts and private native media. The original-versus-emitted oracle passed 9,216 bounded combinations across all nine actions, both equipped slots, skill flags, input/interruption outcomes and timer boundaries. The oracle compares item/player/sword state and exact service-call arguments. The renderer and allocator are service boundaries in that test.

A separate native integration run executes the complete real engine, including allocator, animation and rendering. It begins from a private checkpoint reached with original controls inside Link's house. The fixture explicitly grants the ordinary sword, equips it on A and sets the Spin Attack skill. No player position, attack timer or sword actor is injected. Actual A input allocates the native sword actor, swings, enters charge, becomes ready, spins on release and clears the actor and item context. The source and parity cartridge produce identical traces and encoded videos. The alternate plan reaches charged state on frame 56 instead of frame 96.

This is **controlled native gameplay integration**, not evidence of normal story acquisition. Advanced techniques are covered by the bounded oracle, not a played campaign route. No enemy damage target is included in this first witness. Original art, source and modified ROMs, checkpoints and gameplay recordings remain private ignored artifacts.

The native integration qualification completed in 0.988 seconds on the recorded machine. Its two clean builds took 0.155 and 0.157 seconds and produced 2,194-byte payloads. Build and simulation stages are nested in total time. Queue time and CI measurements are unavailable. The earlier unchanged oracle was reused; its original wall time is unavailable, rather than recorded as zero. These are local measurements, not a cross-machine latency promise.

## Reproduction

With the exact local USA cartridge and a private checkpoint in the house:

```sh
python3 research/deep-extraction/minish-cap/qualify_sword.py \
  --rom 'local/roms/Legend of Zelda, The - The Minish Cap (USA).gba' \
  --state /absolute/path/to/private-checkpoint.ss \
  --out local/re/experiments/unique-minish-sword-qualification
```

The default run builds both plans and executes the original/generated oracle. Qualification alone creates a private, fixed-field fixture session executable; it adds no writable-memory capability to the shared read-only playtester. The three fixture writes are declared in the report. It uses the existing mGBA, C toolchain and ffmpeg; no dependency or CI job was added. A checkpoint in a cutscene or another room is not interchangeable with the retained house route.

The actor/contact implementation is the next dependency being recovered from original instructions. Failed targeted Ghidra launches are retained privately: the first could not write its Java configuration outside the sandbox; the second lacked the new scratch configuration directory. The subsequent run uses an existing private scratch directory and explicit sword actor seeds rather than a broad ROM campaign.

## Attack actor and actual contact damage

The next two recovered packages now compose with the action controller:

- `sword-contact.package.json` implements the complete three-action attack actor, frame-specific hitbox center/extents, mirrored geometry, contact recoil/interrupt handoff, terrain effects and terminal scheduler cleanup. Another 3,072 original/emitted cases pass. `sword-contact-qualification.json` records real native controller+actor integration and the same 40-update plan difference. The recovered body distinguishes the scheduler's nonreturning `destroy_current` service from ordinary `delete(entity)`.
- `contact.package.json` implements the resolved bilateral contact transaction: both damage legs, native heart pool, modifier rules, recoil, stun, invulnerability minima and owner propagation. Another 8,192 original/emitted cases pass. Its typed input is a resolved twelve-byte interaction row; broadphase and matrix selection remain native dependencies.

`combat-parity.plan.json` assembles all three packages. `combat-practice.plan.json` selects a second export from the same source that copies the contact row and zeros its two damage legs. It retains recoil, stun and invulnerability structure. Neither plan changes C or the backend.

`contact-qualification.json` records an actual native encounter. The fixture calls the original cartridge's `CreateEnemy(0,0)`, then places that Octorok relative to Link. The original engine initializes the enemy's stats, graphics and AI; no HP, attack timer, AI phase or damage result is injected. The CPU context and private scratch stack are restored after the bounded native creation call. With the same native A inputs, source and assembled parity cartridges both reduce Octorok HP from 2 to 0 at frame 36 and the original death controller retires the actor. Their traces and encoded videos are identical. The practice plan leaves the same enemy alive at 2 HP.

This final three-package run took 1.177 seconds total, with two clean 4,530-byte builds taking 0.230 and 0.236 seconds. These timings include nested build/simulation stages; prior unchanged local oracle cases were reused. Original-ROM PNG/MP4 recordings and frozen build inputs are under the private run referenced by the compact receipt. The encounter is explicitly a controlled grant, not a normal story route or a whole-campaign qualification. Enemy-specific AI, matrix selection, death animation and drop systems remain retained services until separately recovered.

The native actor oracle caught a concrete decompiler trap: the rock-breaking skill parameter is a logical `LSR 31` result of **0 or 1**, not signed -1. The failed actor compile (hex literal preprocessing token) and mismatching oracle attempt remain private; the corrected body passes the focused native oracle and real engine integration.

## Enemy decisions now recovered too

`octorok.package.json` adds all four ordinary Octorok actions and three subtype policies: region-bounded patrol, randomized rest/walk duration, target acquisition and alignment, attack telegraph, animation-event projectile emission, allocation retry and recovery. Another 6,144 original/emitted cases match, including exact random-draw ordering and typed service arguments.

The four-package cartridge preserves an actual native subtype-2 encounter. It walks, aligns and enters spit at frame 222; the original engine allocates moving projectiles, observed in 13 sampled frames. Source/parity traces and encoded videos match. Qualification took 2.478 seconds; the 5,282-byte clean build took 0.272 seconds. Generic enemy hit/death, movement collision, projectile update and matrix selection remain explicit services. The first subtype-0 fixture did not reach a spit within its 480-frame limit, so its failed witness receipt is retained; it was not reported as a success.

The qualification fixture generator is now shared in `fixture_support.py` and requires no earlier private fixture run. Its generated C is byte-identical to the already-qualified subtype-0 and subtype-2 executables. This refactor was checked by exact source equality and Python syntax parsing, without repeating gameplay. `qualify_contact.py` and `qualify_octorok.py` still require an explicitly supplied private house checkpoint and the exact USA ROM; they do not open accepted player saves. The corpus-level oracle logs can be reused locally to avoid unchanged repeat campaigns, or omitted to run the focused oracle afresh.

## Persistent learning changes legal actions

`progression.package.json` supplies a pure 64-byte inventory policy and explicit native wrappers. Original item state is a two-bit value, not a Boolean. The setter returns the old state and preserves adjacent slots. The derived skill refresh clears its mask, then adds each of twelve capabilities only for persistent state exactly 1; states 2 and 3 remain distinct. The original code targets are getter `0x0807ca84`, setter `0x0807caa0` and refresh `0x0807aee4`.

A native learning event now connects this persistence directly to the recovered sword controller. Without learned item `0x48`, holding A for 110 updates cannot enter charge or spin. Calling the original/emitted persistent acquisition API for that item and refreshing skills enables charge on frame 16, readiness on frame 96 and spin on release at frame 111. Learning item `0x73` adds the fast-charge capability; readiness then occurs on frame 56 under identical controls. The engine cleans up the attack actor in all trials. Source and five-component cartridge traces and encoded video are identical. This is controlled acquisition-event delivery through native APIs, not a claim of playing the trainer dialogue or traversing a world gate.

`progression-qualification.json` retains 12,800 original/emitted inventory/derivation cases and the actual event-to-action recording. The final local native run took 1.177 seconds; its clean 5,586-byte build took 0.299 seconds. The unchanged local oracle was reused. Earlier private fixture failures are retained: restoring an ARM CPU snapshot also requires synchronizing mGBA's active memory-region cache between consecutive native calls. The corrected fixed helper restores that cache and the scratch stack. No shared bot memory-write interface was added.

For the separate automatic ROM-to-IR workstream, these recovered C files are semantic oracles and native adapter references. They are not claimed to be automatically lifted output. Exact own-ROM entries and typed state mappings have been handed off to that agent; independently produced address-free IR and new-ROM lowering are separate qualification work.
