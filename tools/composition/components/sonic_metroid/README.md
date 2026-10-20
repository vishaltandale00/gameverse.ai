# Signal Descent: native Sonic × Metroid campaign draft

This is a real GBA cartridge assembled from a versioned component plan. The
foundation is the locally supplied Sonic Advance USA ROM, SHA1
`d842afa7dd1e84de08addb94a51506f1bcafd551`. No community source checkout or ROM
asset download is used. The retained engine supplies the complete original
campaign geometry, scrolling, parallax, water, native actors and phased bosses.

The new playable layer includes precision ordinary movement, native momentum
handoff, wall kicks, Morph Ball/bombs, beam/charge/missile/ice combat, energy/ammo,
creature freezing/platform contact, four alien roles, eight ability caches,
weapon/ability barriers, heat resistance and checkpoint recovery. The campaign
IR places and connects these systems across the native world definitions. It
also generates the actual ordered resource→weapon→progression→ecology→render
frame calls. Compilation alone is not acceptance of every route.

The integration, creature patterns, placement, story, small OBJ art and HUD are
explicitly new authored bridges. MZM damage, projectile caps/cooldown, freeze,
resource drop and movement policies are recovered from its original ROM;
Sonic terrain/controller/task/render/contact services are independently
recovered from its USA ROM. This is not a claim that every MZM AI or asset was
ported. Native original Sonic enemies also accept projectiles through their
original caller-owned death path. Bosses retain their original phase/HP rules;
eight MZM damage units bridge to one native boss hit.

## Reproduce

```sh
python3 tools/composition/components/sonic_metroid/assemble.py
python3 -m tools.composition.native_build \
  --plan tools/composition/plans/sonic-metroid-signal-descent.json \
  --rom 'local/roms/Sonic Advance (USA) (En,Ja).gba' \
  --out local/composition-builds/signal-descent-your-run
```

`assemble.py` generates readonly world/art data, the executable frame graph,
source-pinned component packages, exact-ROM host/service contracts and plan
bindings. The shared backend compiles/links the graph into immutable Thumb
payload and verifies all hook preimages/intervals/ROM hashes. The original
8 MiB is retained outside the thirteen declared function entry veneers; the
payload is appended in a 16 MiB cartridge. All source snapshots, maps, symbols,
lock provenance and timing receipts are retained in the output directory.
Variants change the graph, typed prefab inputs or bindings and rebuild through
the same backend, rather than editing a cartridge by hand.

## Controls and route

- D-pad moves; A jumps. Hold/release A controls ordinary precision jump height.
- B fires; hold B then release for a charged shot. R+B fires a missile after
  acquiring its cache. L aims/brakes, L+Up aims vertically; diagonal aim also
  works. On a fully arrested airborne wall in FLOW, L+A explicitly transfers
  to precision wall kick. Native moving launches/loops retain Sonic authority.
- Down enters Morph after its cache; Up stands when clear. B places a timed
  bomb while morphed; its explosion opens bomb seals and can lift the ball.
- Freeze creatures with the Ice Beam. A frozen creature is solid support;
  jump onto it, then jump again across an ice-platform barrier. The tutorial's
  required prey respawns if killed, so it cannot permanently lock progression.
- Sustained running transfers to original Sonic momentum before a ramp.
  Speed Booster raises the flow ceiling. High Jump adds jump reach/power grip;
  Screw Attack permits damaging spin contact and organic seals.
- Down at a collected cache or recharge beacon restores resources. While
  holding Down there, press SELECT with Left/Right to return to the nearest
  previously visited ordinary stage in that direction. Original scene services
  rebuild spawn/camera/terrain/music; the relay never unlocks an unvisited stage. Death uses
  original native restart/beacon flow with unlimited retries and retained
  acquired abilities/gates. Stage spawn refills energy/ammo.

Coast Act 1 teaches Morph, missiles, bombs and Ice; Act 2 introduces High Jump,
Speed and an original staged boss. Factory adds Varia/heat resistance, then the
Crystal region also offers Screw. Earlier, High Jump plus Ice stabilizes the first
coastal cache: return through a visited relay to discover Screw there, then use
its spin attack on the newly exposed organic seal. The return reward and seal
have independent ledgers; the earlier missile opening cannot satisfy them. Later regions combine the acquired capabilities,
alien wardens, existing hazards/liquids and retained native campaign bosses.
Native special stages/late boss flows require their own acceptance witnesses.

## State and honest limits

Campaign state lives in a native persistent 1536-byte TaskCreate allocation,
not guessed free RAM. Full emulator checkpoints preserve it. A cold boot starts
a fresh campaign; this draft does not extend Sonic's SRAM save format. Entity
pools and rendering allocations are bounded. Source/header layouts are explicit
in `game.h`, and geometry uses the actual player collision plane at +0x27. Both
planes are valid; original native area triggers switch them. The moving-handle
attachment transfers authority to Sonic FLOW so its release keeps the original
flight arc. Wall kicks, powergrip, both original handles and the upperwest
landing are witnessed in `research/requests/sonic-native-traversal-contract.json`.

The complete game code and campaign graph can build, but qualification is
tracked per actual native scenario and exact cartridge hash. A successful coast
route is not a claim that all fourteen campaign/special definitions, special
stages and final boss routes have been traversed. Failed geometry/ABI/route runs
remain in the local evidence tree. No browser tests or synthetic ability/HP
writes are used as natural-play acceptance.

## Automatically recovered executable impact component

Enemy projectile/body impacts now call `generated/mzm_impact/component.c`,
emitted solely from the qualified address-free L1 recovered from the user's
MZM ROM at 0x08050424. The package pins serialized L1, original-instruction
differential receipt, emitted ABI and byte-identical generated C/header.
`impact_bridge.c` binds HP/death results into the host and preserves all other
split fields in durable entity sidecars. The one context counter remains shared.
Unknown fields remain unknown; the bridge does not write them into guessed
Sonic offsets. Native Sonic enemy/drop/boss phase ownership remains explicit.

`research/requests/sonic-metroid-automatic-impact-proof.json` records actual
beam4→2→0HP, emitted reaction/death fields, native creature removal/drop, and
exact cartridge identity. The fresh coast→firstboss→Factory route and Factory
Varia/heat route also pass on that cartridge. These are bounded witnesses;
later bosses/finale still need their own natural-play acceptance.

## Original Metroid flyer controller and graphics

The species0x16/17 live-controller package recovers patrol, actual terrain-driven
turning, turn/recovery animation, byte-width clocks and initializer state from
the user's MZM cartridge. `mzm_ripper.c` takes explicit terrain, animation
duration and random-input ports. Its28-byte state is portable; the native
bridge converts quarter-pixel displacement to Sonic Q8 and supplies real
current-plane terrain queries.6912 originalThumb/hostC/emittedThumb cases pass,
including actual original empty/solid/out-of-bounds collision processing.
This is the live controller closure; common damage/freeze/death dependencies
remain explicitly owned by the composed impact/host graph. Other alien roles
still use their declared authored patterns.

`extract_mzm_flyer.py` reextracts the original64tiles, palette, five OAM frames
and duration scripts from the exact MZM ROM. `assemble.py` runs it when the
private local asset directory is absent. Both local Sonic and MZM cartridges
are therefore required to reproduce this graph. Raw assets/generated asset C
remain in ignored `local/`; committed packages contain identities and recipes.
The native builder separately verifies the second cartridge hash, data-range
hashes and extraction receipt. Static asset extraction is never mislabeled as
a dynamic behavior witness. A deliberately corrupted range is rejected.

The renderer leases64nativeOBJtiles and a second currently unused palette
bank, preserving all original colors and OAM composition. Scene reset/relay
restore palettes and clear/free both tile leases. Real-cartridge VRAM, palette
and OAM bytes match the extracted originals; the capture shows the original
flyer frozen, then resuming its patrol. See the compact native game proof in
`research/requests/mzm-ripper-native-game-proof.json`. This does not claim the
entire original MZM graphics, audio or enemy engine has been imported.

## Candidate26 authored habitat witness

Candidate25 and its qualification remain preserved. Candidate26 separately adds
an optional `patrol_radius_px` (8px units, 16–120px) to the world prefab. The
bridge and visible boundary markers supply an authored habitat classification
to the original recovered controller; they do not reverse velocity or bypass
its turn states. Zero retains native physical terrain only.

The exact candidate26 cartridge `ef7d653159328e9ab4ac0d67eb63dd212e9c6c8f7382eaf7b683627cb0396605`
now has real native Ice pause/thaw and habitat-driven patrol→turn→recovery→opposite
patrol evidence. Its own fresh-game ancestry also passes first boss/capsule,
Factory Varia/heat and both original moving handles. The old high-speed input
macro failed against the new patrol; a bounded actual diagonal Ice passage
repairs that route. Both attempts remain retained. The qualifier includes that
input fallback, and probes now retain supplied state hashes/action lists and
observe the native collision plane.

`research/requests/mzm-ripper-habitat-proof.json` pins all 41 source snapshots,
nine byte-identical checkpoint ancestry links, screenshots/video, timing and
failed later route attempts. The retained clean build took 0.827131s; the native
habitat witness took 0.378829s and boss/Factory continuation 10.737751s. These are
separate/nested stage contexts, not CI measurements or repeated-run estimates.
Candidate26 stalls later beneath native Factory Act 2 geometry around x2390, plane 1;
wall kicks execute but do not clear the overhang. No authored lock exists at
that position. Later bosses/finale remain unqualified; no forced plane,
teleport, speculative movement edit or terrain bypass was added.
