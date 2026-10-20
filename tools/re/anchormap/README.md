# anchormap — automatic graft-readiness anchor derivation

A prototype that derives the per-game anchors mashup/graft work needs (input
shadow, OAM mirror, position fields, main-loop/IRQ entry, free space) by
scripted memory-diff probing, instead of re-deriving them by hand per
composition. Built against the same Homebrew libmgba as `tools/re/session/`;
no new dependencies (Python stdlib only).

## Build and run

```sh
make -C tools/re/anchormap

# one game, end to end (collect + analyse)
python3 tools/re/anchormap/anchorhunt.py run \
  --rom /abs/game.gba \
  --out local/anchormap-20261016/<game> \
  --base-state /abs/in-game-state.ss     # optional; needed for the movement anchors

# or the two stages separately
python3 tools/re/anchormap/anchorhunt.py collect --rom ... --out ...
python3 tools/re/anchormap/anchorhunt.py analyze --out ... --rom ...
```

`--out` is created if missing; it holds `collection.json`, `profile.json`,
`snaps/` and `shots/`. Without `--base-state` only the cold-boot segment runs,
which reaches menus but not gameplay.

## Files

- `anchormap.c` / `Makefile` — libmgba memory-probe worker. Line protocol:
  `blocks`, `step <keys> <frames>`, `read`/`read32`, `snap <addr> <len> <name>`,
  `shot`, `writemem` (EWRAM/IWRAM only), `save`/`load`, `reset`, `regs`,
  `version`, `close`. Reads the whole bus; writes only WRAM.
- `anchorhunt.py` — segment definitions, collection, and all analysis.
- `rgba_to_png.py` — convert a `shot` RGBA frame to PNG (stdlib).
- `validate.py` — score a `profile.json` against a matching-decomp linker map
  (validation only; the map is never used for discovery).

## Anchor classes and confidence

| Anchor | How | Confidence |
|---|---|---|
| Input shadow | idle-baseline XOR a held key equals that key's mask for every single-key segment | high |
| OAM mirror | sliding 8-byte-entry match of RAM windows against live `0x07000000` | high |
| Position fields | opposite-sign net displacement under held-RIGHT vs held-LEFT, small steps, quiet idle | medium-high |
| Main loop / IRQ | static ARM `B` decode of ROM offset 0; live IRQ vector at `0x03007ffc` | high |
| Free ROM | long `0x00`/`0xFF` runs in the image | medium |
| Free EWRAM | bytes unchanged across all samples | low |

The object-array **stride** is not recovered from movement alone; see the
report for why and what would fix it (moving enemies, or real watchpoints).

## Notes

- Analyse each segment on completion and delete its snapshots for large sweeps
  (~23 MB/game as written).
- libmgba 0.10.5 here is debugger-enabled, so `mCoreAttachDebugger`-based
  watchpoints are a viable upgrade to replace the memory-diff fallback.

Full write-up: `local/anchormap-20261016/anchormap-report.md`.
