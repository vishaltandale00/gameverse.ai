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
in `game.h`, and geometry uses the actual player collision plane at +0x27.

The complete game code and campaign graph can build, but qualification is
tracked per actual native scenario and exact cartridge hash. A successful coast
route is not a claim that all fourteen campaign/special definitions, special
stages and final boss routes have been traversed. Failed geometry/ABI/route runs
remain in the local evidence tree. No browser tests or synthetic ability/HP
writes are used as natural-play acceptance.
