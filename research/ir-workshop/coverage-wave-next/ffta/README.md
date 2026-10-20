# FFTA bounded executable IR reconstruction

The [result](result.json) records three fresh automatic machine-SSA lifts from the USA revision-0 ROM (`AFXE`, SHA-256 `43fc8204c6dceee58828aebc7af0c72eb807e99f35ad641c8bb0a4fa8b6edc19`). The clean source pin is `local/decomps/ffta-decomp@7f0e9ad222eb7b04f7c87beeefa36965a6e5d476`. The source ledger and declarations map the entries; actual compiled source supplies fixture expectations. A fresh full matching source/ELF build was not performed: the expected local agbcc installation is absent.

- `ReadCurrentContentIndex` at `0800a018`: one canonical global u16.
- `ReadContentIndexOrFallback` at `0800a024`: two canonical global u16 fields; zero fallback selects current.
- `NextRandom15` at `08002804`: independent canonical global u32 RNG update. It is not a dependency of the index readers.

The existing provider actually lifted, lowered, compiled and linked all three, and passed 256 original plus 256 rebuilt-entry native cases per function. Expectations and poststate come from compiling the pinned C source, including zero fallback, u16 boundaries and u32 overflow cases. Total provider time was **1.849078208 seconds**; its pre/post compiler/provider pins stayed equal. This was one approved bounded run with no repair or duplicated prior qualification.

The output is **16,777,364 bytes**, SHA-256 `4b3dad50a092360b2d9902e1ffa29fcb6f604c3f77e9c063f68f207fced8f348`. The appended 148 bytes contain **46 behavior bytes, 100 storage-binding bytes and 2 alignment bytes**; three original-entry veneers occupy 24 bytes. The numeric palette source independently assembled into **512 exact original bytes** at `0x9581d8`. Its 256 little-endian BGR555 colors and source identity are proved; its actual typed loader/consumer remains open. All 512 bytes appear in the final rebuilt image.

**16,776,680 bytes remain opaque-preserved** in 20 output spans, including old native function tails. The 72 bytes of source function envelopes are provenance, not extra regenerated coverage. Seven closure records are enumerated; the total semantic closure count is unknown. Original callers, concurrency/IRQ observations, initialization, save/scheduler lifecycle, full asset semantics and whole-game equivalence remain unproved. Every generated entry has no incoming parameters/entity bases, so the 8-byte veneer has no incoming r3 data dependency; admitted invocation is synchronous Thumb AAPCS with a valid disjoint stack and no concurrent writer.

The retained files are:

- `local/roundtrip/coverage-next-ffta-inputs-001`: compiled source oracle/fixtures, palette assembly, source/ROM pins and profiles.
- `local/roundtrip/coverage-next-ffta-baseline-001`: exact 16 MiB palette plus opaque reconstruction.
- `local/roundtrip/coverage-next-ffta-ir-001`: fresh producer inputs, native proofs, ELF, output, layout and dependency frontier.
- `local/roundtrip/coverage-next-ffta-bundle-001`: standalone private component bundle.
- `local/roundtrip/coverage-next-ffta-bundle-replay-001.gba`: artifact-only replay, same hash, 0.024221 seconds. This replay copies admitted artifacts and explicitly reports `ir_regeneration:false`; generic per-game IR-regenerating bundle support is still open.

Do not rerun into these immutable output paths. `prepare.py` and `finalize.py` document the performed source-oracle/palette preparation and receipt derivation. The actual provider invocation was:

```python
from tools.roundtrip.ir_provider import run
run(profile, original_rom, baseline_manifest, new_output_directory, 256)
```

Existing bundle commands were `python3 -m tools.roundtrip.private_bundle export` and `rebuild`; no shared compiler, provider, registry or public artifact was changed. No JVM, gameplay campaign, model call, UI or mashup run occurred. Timings are first-run evidence; a comparable before/after measurement is unavailable.
