# Fresh FFTA execution from the retained profile

These are executable commands, **not rerun by this documentation pass**. Run from the repository root. They require the private original ROM and retained source-oracle/palette inputs. Select fresh paths: existing output directories are rejected. Native runs require the active coordinator's execution slot. The script runs the current compiler/provider, so equality to the retained output is expected only when its exact tool/compiler pins agree; it never claims automatic acceptance of changed compiler output.

```sh
python3 -m tools.roundtrip roundtrip \
  --source 'local/roms/Final Fantasy Tactics Advance (USA).gba' \
  --profile local/roundtrip/coverage-next-ffta-inputs-001/palette-profile.json \
  --output local/roundtrip/coverage-next-ffta-baseline-fresh \
  --game-id final-fantasy-tactics-advance

python3 research/ir-workshop/coverage-wave-next/ffta/reproduce_existing.py \
  --baseline local/roundtrip/coverage-next-ffta-baseline-fresh/manifest.json \
  --output local/roundtrip/coverage-next-ffta-ir-fresh \
  --vectors 256

python3 -m tools.roundtrip.private_bundle export \
  --input local/roundtrip/coverage-next-ffta-ir-fresh \
  --output local/roundtrip/coverage-next-ffta-bundle-fresh

python3 -m tools.roundtrip.private_bundle rebuild \
  --input local/roundtrip/coverage-next-ffta-bundle-fresh \
  --output local/roundtrip/coverage-next-ffta-replayed-fresh.gba
```

The first command regenerates the exact baseline from admitted palette bytes plus captured remaining host bytes. The second actually rereads pinned own-ROM HighFunction inputs, automatically lifts to IR, lowers C, compiles/links, installs three entries, and runs 256 original plus 256 rebuilt native cases per entry. Existing fixture expectations were produced by executing the pinned source C; this wrapper reuses those immutable expectations rather than rerunning their source oracle. It is a fresh producer execution, not an artifact replay. The final command is artifact-only `rebuild_only` replay, with `ir_regeneration:false`.

The observed producer used precisely `tools.roundtrip.ir_provider.run(profile, original_rom, baseline_manifest, fresh_output, 256)`, now exposed by `reproduce_existing.py`. It passed in 1.849078208 seconds; the retained output SHA-256 is `4b3dad50a092360b2d9902e1ffa29fcb6f604c3f77e9c063f68f207fced8f348`. No whole-game closure or fresh full-source ELF is established. `prepare.py` remains the historical performed source-oracle/palette preparation with its immutable `inputs-001` path; do not run it to overwrite that packet.
