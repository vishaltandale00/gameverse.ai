# Building the native GBA mashup

The foundation is the entire USA Metroid: Zero Mission decompilation: world,
rooms, events, original assets, Samus movement, jumps, equipment and gates. The
candidate adds a native GBA encounter mode with Emerald-derived battle code and
sprites. Browser JavaScript does not implement this game's physics or combat;
the result is a `.gba` executed by an emulator.

The initial source-built baseline is byte-identical to the indexed USA ROM:
SHA1 `5de8536afe1f0078ee6fe1089f890e8c7aa0a6e8`, 8,388,608 bytes. Its ELF and map
provide the symbols used by the bot harness. A matching baseline proves the
source/toolchain input identity; it does not qualify every campaign route.

## Local inputs

- MZM source: `local/decomps/mzm`, commit
  `9caaefc0ee570f3399d86acf140fdeada9692836`.
- Emerald source: `local/decomps/pokeemerald`, commit
  `731ad5bfd6e6f265508d0efcca0ba42f9dcf5881`.
- Owned USA base ROM: `local/roms/Metroid - Zero Mission (USA).gba` with the SHA1
  above. The builder rejects other bytes; it does not download ROMs.
- Compiler: `https://github.com/jiangzhengwenjz/agbcc`, commit
  `59b966ed1b8f371856dcf99f1546c2fe89c678ca`, built under
  `local/game-builds/toolchains/agbcc-mzm`. Run `bash build.sh` in that checkout
  once. The cached Pokémon compiler is insufficient because it rejects the
  required `-f2003-patch` option.
- Existing ARM binutils, host C compiler, make and Python3. The extractor also
  uses Pillow to read the pinned source PNGs; use an existing Python environment
  that provides it. The ROM builder itself uses only the Python standard library.

ROMs, generated source/data containing game assets and all build workspaces stay
under ignored paths. Sharing the implementation means sharing these scripts and
source bridges, not committing proprietary binary artifacts.

## Commands and limits

Generate the Emerald source/data slices first. Their provenance manifest records
original file/span hashes, source pin and sprite conversion details:

```sh
python3 tools/gba_mashup/extract_emerald.py
```

Choose a fresh output directory for each build. Existing workspaces are preserved
and the builder refuses to reset them. The default limit is four compile jobs and
240 seconds for the make stage; the explicit options below retain those limits.

```sh
python3 tools/gba_mashup/build_mzm.py \
  --work-dir local/game-builds/mzm-emerald-wilds-v2-example \
  --native tools/gba_mashup/native \
  --jobs 4 --timeout 240
```

For an unmodified, exact baseline, omit `--native`. `--source`, `--compiler` and
`--rom` select explicit local paths. The source is exported by its fixed commit
into the new workspace; the canonical decompilation is never edited. The
compiler source pin, executable and library hashes are recorded.

The ROM, ELF and symbol map are `mzm_us.gba`, `mzm_us.elf` and `mzm_us.map` inside
the chosen workspace. The sibling `WORKSPACE-receipt.json` records stage
commands, durations, limits, outcome, source hashes and artifact hashes. A sibling
source patch and per-stage logs preserve exact integration edits and failures.
Build success is distinct from emulator qualification, which the session harness
records separately against the exact output hash.

The adapter uses a checked preprocessing pipeline because the upstream shell
pipeline can swallow an early missing-include error. On macOS, host `cpp` also
needs explicit C mode and stdin handling. The unchanged NES unlockable tail is
copied from the matching base ROM at offset `0x7d8000`; all core MZM gameplay C
and its extracted assets are compiled. The matching baseline includes that
unchanged tail, rather than rebuilding the separate NES emulator project.

## Original v1 native encounter contract

The following describes the preserved v1 artifact. Current source implements v2;
see the v2 contract below and its recipe for changed contact/party behavior.

`gv_native.c` is new display/input/integration glue. `emerald_bridge.c` contains
the declared reduced battle adapter; its generated includes hold the exact
selected Emerald functions, data tables and six front/back sprite images.

- Normal world play: a newly pressed **Select**, or health loss observed on the
  preceding gameplay frame, requests an encounter through the normal pause fade.
  Health loss includes environmental hazards; it is not a verified conversion of
  the specific colliding Metroid enemy into a Pokémon species.
- Battle: directional input selects a move, **A** executes, **B** opens/closes the
  party menu, **A** confirms switching, **Select** retreats. After a win/loss,
  **A** resumes the mission. Each side currently has three configured Pokémon.
- Victory restores eight Samus energy up to capacity; defeat halves remaining
  Samus energy with a minimum of one. These are explicit new bridge rules.
  Retreat gives no reward. The Pokémon parties reset per encounter. Native
  campaign inventory, equipment and gates remain governed by MZM source.
- On return, encounters have a 180-gameplay-frame cooldown. Existing field
  enemies are not removed or marked defeated by a battle victory. The campaign
  clock is paused because the encounter runs through the pause game mode.

Entry happens only through `ProcessPauseButtonPress`, honoring the original
pause restrictions. The custom branch of `GM_MAP_SCREEN` calls
`PauseScreenInit`, which backs up the source game's OBJ graphics and establishes
its existing palette/minimap pause data. The encounter takes over the hardware
with a Mode3 bitmap and explicit BG2 identity transform; it disables game HBlank
DMA while active. Rendering happens on input/state changes, not every frame.
Actual Pokémon sprite pixels are blitted from ROM to GBA VRAM.

Exit leaves the normal pause flag set and enters `GM_INGAME` submode0. Source
`InitAndLoadGenerics` restores saved OBJ/palette data and reloads the original
room graphics. With `gSubGameMode3` preserved, `SamusInit` does not create a new
character or reset equipment. Position/room restoration still requires the
separate emulator qualification; it must not be inferred from compilation.

New session state and bridge scratch globals are linked into free IWRAM
before the existing interrupt vectors. They do not use the lower EWRAM scratch
area, which the original game uses for destroyed-block history. New code and
constant data occupy a separate ROM section before the unchanged NES payload.
The source linker remains responsible for overlap errors. The current candidate
uses approximately address `0x03005d7c` for `gGvBattle`; consumers must resolve
symbols from each build's ELF rather than hardcode this example.

## Boundaries and measured build work

This version is an encounter integration, not the entire Emerald game runtime.
The declared bridge omits Emerald's full AI script interpreter, items, doubles,
badges and broad status/move support. Its damage/type functions and selected data
are extracted from pinned source; party setup, AI selection bridge, weather by
MZM area and the encounter transition are explicit adaptations. Generated source
provenance identifies which rules were copied and which glue was added.

On the initial Apple Silicon macOS environment, compiler bootstrap took 31.159s,
core baseline compilation 11.710s, and final unchanged NES inclusion/link 0.298s.
The candidate clean make took 15.6169s and its full builder run 17.1557s, four jobs,
warm compiler, cold source objects. Those are different inputs and preprocessing
paths, so they are not a before/after regression measurement. Failed compiler,
preprocessor and missing-NES attempts remain in the baseline receipt. No CI job,
new build dependency matrix or full-campaign qualification was added.

## V2 source actor contract

Current native source hooks `SpriteUtilSamusAndSpriteCollision` after its exact
hitbox-overlap check. Eligible ordinary actors capture identity before damage;
the next gameplay frame enters through the normal pause fade. `SpriteDraw` uses
the original spriteset allocation only when no unmapped/different-species actor
shares it, including multi-slot overlapping allocations. Rendering and contact
share this guard. Source AI and hitboxes remain authoritative.

`GvWildLink` is20bytes: identity(u32), species/x/y(u16 each), RAM slot/native
ID/area/room/active/resolution(u8 each), wins/retreats(u16 each). Identity packs
area<<24 | room<<16 | roomSlot<<8 | nativeId. Resolution0is pending/active,
1victory,2party rescue,3retreat. `GvBattle` remains288bytes. Symbol-resolved
`gGvWorldDrawIdentity`, `gGvWorldDrawSpecies` and `gGvWorldDrawCount` identify actual
field drawing. `gGvDefeatedIdentities[128]` and `gGvDefeatedCount` expose bounded
session history; full checkpoints preserve all this IWRAM state.

A clean v2-r1 build with four jobs, warm compiler and cold source objects took
15.5533s for make and17.1495s total on this machine. The earlier v1 comparable
candidate make was15.6169s and17.1557s total; observed difference is-0.0636s make
and-0.0062s total, a single-run comparison rather than a performance guarantee.
No dependency or CI stage was added. Gameplay qualification remains separate from
this build and must name the exact ROM hash.
