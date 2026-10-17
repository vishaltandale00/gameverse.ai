# Deterministic original fixture recipes

`scripts/rom-fixture-recipe.mjs` exports `prepareRomFixture({identity, romPath,
directory, runtimeRoot, signal})`. The original must match the committed registry
identity, byte count, SHA-1 and GBA title/code/maker/revision. Modified and unknown
originals fail before output. The callback never calls a model or downloads data.
Only private preparation directories receive generated assets.

The exact Metroid Zero Mission USA original additionally matches SHA-256
`fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37`.
Its `mzm-species-22-visual-assets` v1 recipe reuses the existing research extractor's
species 22 tile/palette/OAM closure with its minimal stdlib PNG encoder. Python 3
is the sole extraction runtime; there is no emulator or compiler dependency.
The subprocess has a 15-second limit and accepts cancellation.

The resulting relative artifact references include `tiles.4bpp` (64 tiles),
`palette.bgr555` (16 colors), `animation.json` (five OAM frames and three animation
scripts), C source/header usable by native consumers, a contact sheet, extraction
provenance and `source-binding.json`. Every artifact records type, count, byte
length and SHA-256. The recipe records the extractor SHA-256. These are original
visual assets, not behavioral IR or a runnable/qualified game. Consumers must use
the declared layout and preserve host engine semantics.

Other registered originals produce a source-binding receipt and a blocked result
with explicit remaining inputs. For LeafGreen, FireRed, Emerald and Sonic Advance,
a configured runtime root is checked for the existing pinned decomp commits.
Three declaration files are read from immutable Git HEAD blobs, hashed and counted;
the commit/tree and working-tree dirty state are recorded. No private source paths
or declaration contents appear in public job metadata. Missing source, a different
commit or unreadable declarations is explicit. Metadata availability does not prove
that source builds the uploaded revision. Native fixture compilation remains the
separate bounded pipeline action and is never launched by this recipe.

`completed` means this recipe's declared visual fixture capability is available;
check `fixture_capabilities` and `scope` before using it. Preparation timings mark
native build, simulation, evaluation and queue measurements unavailable. The nested
recipe duration must not be added to the enclosing preparation total.

Focused tests exercise identity, size, modified input, symlink and cancellation
guards with synthetic bytes. They add no CI job, dependency or broad campaign. An
owned-ROM qualification can additionally compare C/header/PNG hashes against the
existing research extractor without committing cartridge or generated asset bytes.
