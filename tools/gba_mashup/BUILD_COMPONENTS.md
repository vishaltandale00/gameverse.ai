# Build whole GBA cartridges from component graphs

The component builder consumes an IR composition plan, versioned packages and a
pinned ROM host contract. New variants change graph inputs. They do not require
edits to the builder or C bridge. The older `build_mzm.py` source experiments remain
available explicitly and their qualified cartridges/receipts are preserved.

```sh
python3 -m tools.gba_mashup.build \
  --plan tools/composition/plans/sonic-native-parity.json \
  --rom 'local/roms/Sonic Advance (USA) (En,Ja).gba' \
  --out local/composition-builds/my-sonic-parity

python3 -m tools.gba_mashup.build \
  --plan tools/composition/plans/sonic-metroid-airborne.json \
  --rom 'local/roms/Sonic Advance (USA) (En,Ja).gba' \
  --out local/composition-builds/my-sonic-metroid-airborne
```

Each output directory must be new. Builds require existing `cc` with ARMv4T target
support and `arm-none-eabi-{ld,objcopy,nm}`. No dependencies are installed, source
repositories downloaded, model calls made or player saves accessed. ROMs and
build/media outputs stay ignored. No CI job or campaign is added.

## Executable contract

`native_build` extends IR0.1 with `gba-component-native/1`. Its package and host
references include SHA256. The static resolver rejects conflicting dependency,
port and state declarations; the native backend independently checks the supported
lowering subset. Unknown declarative port transforms/transitions are rejected by native v1;
executable bridges must be packaged. Static obligations remain in
`static-resolution.json`; building
an experimental candidate does not discharge route or qualification obligations.

A package's `lowering.native_v1` supplies:

- `sources`: every local source/include file and its hash; `translation_units`
  selects compilation roots. Includes are snapshotted with their relative paths.
- `exports`: named `void` or `i32` functions taking at most four `ptr/u32/i32/u16/i16`
  arguments under ARM7TDMI Thumb AAPCS. Larger contexts need a versioned explicit
  struct contract. There is no fallback to arbitrary source string insertion.
- `requires`: exact package ID/version dependencies. Missing versions, cycles and
  duplicate instantiations fail. Shared/reentrant instantiation is unsupported.
- `state_bindings`: typed existing actor storage, extent and field offsets.
  Generated `state-layout.h` checks field offsets and size. New mutable static
  state is deliberately unsupported: the linker rejects `.bss`, `.data` and
  COMMON instead of guessing unused RAM.

The host pins the complete ROM and declares each supported entry's exact address,
8-byte preimage, unique cardinality, phase, state writes and reviewed leaf ABI.
Hook arguments bind the native r0 actor, immutable allowlisted ROM pointers, or
allowlisted scalar RAM reads. Unknown ABI/read contracts, overlapping hooks,
missing state authority, changed recovery ranges, source hashes or ROM identities
fail before compilation. Function calls and source dependencies are trusted only
within explicitly reviewed recovered/lowering packages; this backend is not a
C semantic verifier or a complete instruction-lifting system.

The backend compiles packages and generated ABI bindings, links at the end of the
full original cartridge, then emits exact Thumb entry veneers. For this Sonic host,
8MiB expands to a padded16MiB cartridge. A bytewise invariant checks every original
byte outside graph-owned entry veneers. All stages have finite time limits, a total default60s build budget (maximum300s),
plus an explicit maximum native payload size. This preserves the full original world,
assets and campaign; it does not by itself prove campaign compatibility.

Generated artifacts include the cart, ELF, link map, source snapshots, binding C,
state declarations, static resolution, `composition.lock.json` and `receipt.json`.
The lock maps plan/package/source identities through generated symbols, entry
addresses and output bytes to the exact cartridge hash. Receipts pin backend and
compiler/linker binaries and record outcomes and per-stage wall time, including
failure. Stage durations are nested within total time; queue time is unavailable.

## Sonic proof and actual limitation

Both checked-in plans use **the same package, recovered sources and backend**.
The first binds five independently recovered Sonic operators. The second changes
only two bindings to a reusable MZM-to-Sonic bridge: bounded ordinary-airborne
integration and gravity. Native slope projection, detachment and momentum remain
Sonic. The bridge's conservative guard preserves Sonic behavior outside ordinary
flat jumps, on inherited overspeed and under inverted gravity. It is newly authored
glue around recovered arithmetic, not an original recovered hybrid game.

Initial clean builds took0.135s and0.123s respectively on the same local ARM Mac,
with668/676-byte payloads. Native execution then showed exact parity for all794
sampled states and an identical video for the recovered-Sonic plan. The hybrid
changed observed gravity42→80 in its active branch, confirming the composed
operator executes. **That candidate failed traversal**: the retained Sonic jump
impulse was incompatible with MZM gravity and produced129 sampled dead-state
frames. Its failure and media are retained; it is not accepted or offered as a
finished game. A typed jump/contact dependency must be closed next. Neither plan
implements the requested ecology, weapons, upgrades or complete mashup yet.

Evidence is under `local/re/experiments/20261016-sonic-self-decompile/`:
`composition-play-comparison-01.json`, `composition-play-sonic-native-parity-01/`,
and `composition-play-sonic-metroid-airborne-01/`. The partial bridge also passed
57,344 original-instruction arithmetic/guard vectors; this does not supersede the
failed real-game route. New gameplay candidates must repeat relevant native
checks; no amount of static metadata can qualify the whole campaign.

The next versioned package closes the jump dependency: a complete own-ROM jump
initializer with explicit native headroom, pose/hitbox and sound services. Two
additional plans select either native impulse or MZM-compatible impulse through a
constant argument; both use exactly the same1.1 package/backend. These final clean
builds took0.147s/0.149s, emitting1202/1210 bytes. The parity plan again matched all794
states and the original video. The hybrid starts with−1536 vertical velocity and
then adds80 per frame, versus−1248/+42 originally. It traversed720 native frames
without observed dead flags, ending atx2125.03px. Both carts retain the entire
Sonic campaign; this bounded early-stage result does not prove all routes/loops.
Actual playable ROM hashes, trace/media hashes and retained failure are recorded
in [native-assembly-evidence.json](../../research/composition/native-assembly-evidence.json).

Reproduce these newer plans with the same command above, substituting
`sonic-native-jump-parity.json` or `sonic-metroid-jump-airborne.json`. Captures are
`composition-play-sonic-native-jump-parity-01/` and
`composition-play-sonic-metroid-jump-airborne-01/` under the same evidence root.
This remains a movement assembly milestone. Ground/air control, release, all-route
contact, combat/ecology, upgrades and progression still need deeper components.
The native builder intentionally does not register this partial candidate as a
completed mashup in Play.

The eight native contract checks plus nine existing resolver checks passed in
0.010s. No comparable preexisting component-builder baseline exists. These timings
are not comparable to a different game's full source rebuild and are not a build
latency SLA.
