# MLSS bounded active logo asset expansion

`result.json` records a real **active asset append**, from 112 map-reachable 8bpp tiles to 113. The source declaration remains a fixed 256-tile/16,384-byte array, and the native transfer remains exactly that size. There is **no backing allocation, ROM, transfer-size, or hardware-capacity growth**. The active count is captured map reachability, not an invented source count variable.

The pinned source map references every index 0..111 and no larger index. Every byte of slots 112..255 is zero. The request appends a new 64-pixel checker tile to slot 112 and updates visible map cell (1,1) to reference it: 65 original-ROM bytes change. A second edit changes the first new pixel and changes its rendered color. All original retained padding stays exact except the explicitly appended slot.

Source attribution uses clean `mlss@b03634c2c700a3ae78f39e576cc88a45c3a724fd`, exact USA Rev0 ROM SHA-256 `af9066e7eacdab919e92987db8856d038e4b75d4ed011259c893702085a886be`, and a fresh exact narrow assembly match of the 20,436-byte logo source section. The source consumer's fixed array declarations, two literal pointers, tile and map copy lengths, destinations, pixel format, and ownership are captured. The aligned literal-pointer scan is supporting evidence; it is not automatic discovery of arbitrary interior/encoded references. This closure is bounded to the retained logo subsystem.

The private snapshot of the existing memory compiler emits typed IR and complete generated C patch arrays. An ARM data-object build verifies the C tables and each patch array. Identity is byte exact. Every compile runs with `Path.read_bytes/read_text` denied after its manifest and ROM inputs are loaded, including the follow-up using the generated manifest. Negative controls reject a map reference before backing exists, tile 257 beyond fixed transfer capacity, and a pixel outside u8.

The bounded mGBA proof executes **original** `sub_8018218` mode0 enqueue and **original** `sub_801859C` queue consumption during VBlank. It checks both exact descriptors, the 16,384 tile bytes and 1,280 map bytes copied through native DMA, fixed-transfer boundary canaries, and preserved r4..r11/SP. A 512-byte palette transfer uses the same original transfer function's mode2 path. Three cases (identity, appended, follow-up) each execute 377 native instructions and three bounded idle frames, checking all 64 pixels of the edited cell against its hardware tile/map/palette interpretation. Pixel 0 differs between append and follow-up; the new checker has two visibly distinct colors. Two initial renderer initialization failures and their repair are retained in the result.

Reproduction uses existing tools only; no full build, dependency installation, DSL, discovery run, publication, or CI change:

```sh
mkdir -p local/roundtrip/ontology-wave-mlss/snapshot
cp tools/roundtrip/memory_ontology.py tools/roundtrip/graphics_contracts.py local/roundtrip/ontology-wave-mlss/snapshot/
touch local/roundtrip/ontology-wave-mlss/snapshot/__init__.py
python3 -B research/ir-workshop/ontology-wave/mlss/produce.py
python3 -B research/ir-workshop/ontology-wave/mlss/verify_native.py
```

Original ROM/source inputs, source-assembled objects, manifests with captured bytes, candidate ROMs, generated C/IR/data objects, native executable, and per-case receipts stay under `local/roundtrip/ontology-wave-mlss`. Four exact manifest pins are in public `memory_manifest_refs`. Public recipes/results contain no cartridge asset blobs.

Each subprocess is capped at 30 seconds (native case 10 seconds); each native call is capped at 20,000 emulator dispatches. Recorded capture, property compilation, data-object build, harness build, and native case durations are local measurements, with nested stages marked. Queue, CI, full game build, and comparable before/after full-build timings are unavailable. Full initializer/scheduler/gameplay/save-lifetime behavior remains unqualified. Graphics structural checking uses the supported fixed tile-transfer contract; the visible 32x20 map's native render is separately verified because the generic full-screenblock map validator supports only 32/64 tile dimensions.
