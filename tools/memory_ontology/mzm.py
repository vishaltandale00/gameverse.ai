"""Source-declared, ELF-witnessed Zero Mission animation family extraction.

No pixels, C bodies, native caller closure or free-space authority are inferred.
Assets are written only to the caller's explicitly private snapshot directory.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import struct

from tools.roundtrip.source_provider import elf_range

ROM_BASE = 0x08000000
FAMILY = "mzm.background-animated-graphics"
SOURCE_FILES = (
    "include/types.h", "include/macros.h", "include/structs/animated_graphics.h",
    "include/constants/animated_graphics.h", "include/data/animated_tiles_data.h",
    "src/data/animated_graphics_data.c", "src/data/animated_tiles_data.c",
    "src/animated_graphics.c", "src/room.c", "src/globals1.c",
)
SYMBOLS = {
    "sAnimatedGraphicsEntries": 304, "sAnimatedTilesetEntries": 384,
    "sAnimatedTilesGfx": 12800, "sAnimatedTankGfx": 2048,
    "sAnimatedLiquidsGfx": 6144, "gAnimatedGraphicsData": 192,
    "gAnimatedGraphicsToUpdate": 2,
}
SOURCE_PROFILE = {
    "include/types.h": "3274f293eee99076767cf2dc494e58c2b7b142c19246585eb1b61866fb4a6072",
    "include/macros.h": "498ae35e7d2774c4ae5c84a46dc677f94a61070362175d6d56bc52b5f542a7ed",
    "include/structs/animated_graphics.h": "d83effd1ad2d5c8e4d86715cf2722ac43f2d37d26e1f3d853472df7aa4eabac6",
    "include/constants/animated_graphics.h": "f7eeeaaf1aa316f8b2051f34ca8c5f6eb4368df22e56a348ee7518f271d6f165",
    "include/data/animated_tiles_data.h": "48ee25533c82126cfc22953d1f4ab5145e4da1bf9f1be11403e1c9fe53d1d42c",
    "src/data/animated_graphics_data.c": "b67f5857dcf5adafdb9b0f6460dc1960dac7aa7f5a51a474fda0c22fe3291319",
    "src/data/animated_tiles_data.c": "cc157f6da9b6ae2d343a6fd794c409787fd4f3c0272859dd8a67d12ab7b573cf",
    "src/animated_graphics.c": "d55d21e9a00c0559e48821a83982ef91a91c2579f7dbd8f23795a5adc886c8f0",
    "src/room.c": "cd96bc71839be730609586312e375878088618bcafe27483ba20809511bd229a",
    "src/globals1.c": "e9cdbad78d09de47a9c63ede2a374cb3aadf8220eb36bcb5bcce4e3ef6b9dc35",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _symbols(elf):
    if elf[:6] != b"\x7fELF\x01\x01":
        raise ValueError("MZM requires ELF32 little-endian")
    header = struct.unpack_from("<16sHHIIIIIHHHHHH", elf)
    if header[2] != 40:
        raise ValueError("MZM requires ARM ELF")
    sections = [struct.unpack_from("<10I", elf, header[6] + i * header[11])
                for i in range(header[12])]
    result = {}
    for section in sections:
        if section[1] != 2:
            continue
        strings = sections[section[6]]
        names = elf[strings[4]:strings[4] + strings[5]]
        for pos in range(section[4], section[4] + section[5], section[9]):
            offset, address, size, info, _, index = struct.unpack_from("<IIIBBH", elf, pos)
            name = names[offset:].split(b"\0", 1)[0].decode("ascii")
            if name in SYMBOLS:
                if info & 15 != 1 or size != SYMBOLS[name] or name in result:
                    raise ValueError("Unexpected MZM object layout: " + name)
                result[name] = {"name": name, "address": address, "size": size,
                                "elf_symbol_type": "STT_OBJECT", "section_index": index}
    if set(result) != set(SYMBOLS):
        raise ValueError("MZM ELF lacks required animation objects")
    return result


def extract_mzm(source_tree, rom_path, elf_path, private_dir):
    """Capture replayable typed records and exact private blobs, verifying ELF/ROM.

    Source text is retained as provenance and dependency evidence. Descriptor
    values are decoded from the source-built ELF, never claimed source parsing.
    """
    root, output = Path(source_tree), Path(private_dir)
    output.mkdir(parents=True, exist_ok=True)
    rom, elf = Path(rom_path).read_bytes(), Path(elf_path).read_bytes()
    symbols = _symbols(elf)
    sources = []
    for relative in SOURCE_FILES:
        data = (root / relative).read_bytes()
        if digest(data) != SOURCE_PROFILE[relative]:
            raise ValueError("MZM source differs from admitted typed recipe: " + relative)
        sources.append({"path": relative, "sha256": digest(data)})
    records, blobs = [], {}
    for name, symbol in symbols.items():
        record = {**symbol, "id": name, "region": "IWRAM" if symbol["address"] < ROM_BASE else "GamePakROM"}
        if record["region"] == "GamePakROM":
            payload = elf_range(elf, symbol["address"], symbol["size"])
            offset = symbol["address"] - ROM_BASE
            if rom[offset:offset + symbol["size"]] != payload:
                raise ValueError("MZM ELF/ROM bytes disagree: " + name)
            filename = name + ".bin"
            (output / filename).write_bytes(payload)
            blobs[name] = payload
            record.update(rom_offset=offset, sha256=digest(payload), blob_path=filename)
        records.append(record)
    table = blobs["sAnimatedGraphicsEntries"]
    selectors = blobs["sAnimatedTilesetEntries"]
    entries = []
    for index in range(38):
        kind, delay, count, padding, pointer = struct.unpack_from("<4BI", table, index * 8)
        candidates = [s for n, s in symbols.items() if n.endswith("Gfx") and
                      s["address"] <= pointer < s["address"] + s["size"]]
        if len(candidates) != 1:
            raise ValueError("Animation pointer lacks unique source-declared asset")
        asset = candidates[0]
        # NONE still loads frame zero. Nonzero kinds use descriptor frame count.
        extent = max(1, count) * 128
        if pointer + extent > asset["address"] + asset["size"]:
            raise ValueError("Animation frame extent escapes asset")
        uses = [{"tileset": row, "slot": col, "selector_byte_offset": row * 48 + col * 3}
                for row in range(8) for col in range(16)
                if selectors[row * 48 + col * 3] == index]
        entries.append({"index": index, "type": kind, "framesPerState": delay,
                        "numberOfStates": count, "padding": padding, "pGraphics": pointer,
                        "asset": asset["name"], "asset_offset": pointer - asset["address"],
                        "reachable_frame_bytes": extent, "selector_references": uses,
                        "selector_reference_count": len(uses)})
    if any(selectors[row * 48 + col * 3] >= 38 for row in range(8) for col in range(16)):
        raise ValueError("Out-of-range animation selector")
    references = []
    for relative in SOURCE_FILES:
        if not relative.endswith(".c"):
            continue
        for line, text in enumerate((root / relative).read_text().splitlines(), 1):
            for name in SYMBOLS:
                if re.search(r"\b" + name + r"\b", text):
                    references.append({"symbol": name, "source": relative, "line": line,
                                       "kind": "lexical-source-reference", "text": text.strip()})
    return {"schema": "gameverse.mzm-animation-family/1", "game_id": "metroid-zero-mission",
            "family_id": FAMILY, "rom_sha256": digest(rom), "elf_sha256": digest(elf),
            "source_files": sources, "records": records, "entries": entries,
            "source_references": references, "source_reference_count": len(references),
            "selector_reference_count": sum(e["selector_reference_count"] for e in entries),
            "pixel_origin": "ELF captured, source declaration and include path known; extracted pixel include absent",
            "new_behavior_ir_bytes": 0, "native_consumer_closure": "unresolved",
            "layouts": layouts(), "dependencies": dependencies()}


def layouts():
    return [
        {"id": "AnimatedGraphicsData", "size": 8, "alignment": 4,
         "fields": [{"name": n, "offset": o, "type": t} for n, o, t in
                    [("type", 0, "u8"), ("framesPerState", 1, "u8"),
                     ("numberOfStates", 2, "u8"), ("pGraphics", 4, "gba-rom-ptr32")]],
         "padding": [{"offset": 3, "size": 1}], "count": 38},
        {"id": "AnimatedGraphicsInfo", "size": 12, "alignment": 4, "count": 16,
         "fields": [{"name": n, "offset": o, "type": t} for n, o, t in
                    [("type", 0, "u8"), ("framesPerState", 1, "u8"),
                     ("animationDurationCounter", 2, "u8"), ("numberOfStates", 3, "u8"),
                     ("currentAnimationFrame", 4, "s8"), ("graphicsEntry", 5, "u8"),
                     ("pGraphics", 8, "gba-rom-ptr32")]],
         "padding": [{"offset": 6, "size": 2}]},
        {"id": "AnimatedTilesetSelector", "size": 384, "dimensions": [8, 16, 3],
         "selected_field_offset": 0, "selected_type": "u8", "bound": 38,
         "remaining_two_bytes": "source macro zeros; not interpreted by this consumer"},
        {"id": "AnimatedFrame", "size": 128, "transfer": "DMA3_COPY_16 64 halfwords",
         "format": "uncompressed tile bytes; pixel bit-depth must be admitted by graphics contract",
         "compression": "none on reviewed DMA path"},
    ]


def dependencies():
    return [
        {"from": "sAnimatedTilesetEntries", "to": "sAnimatedGraphicsEntries", "kind": "selector-index", "status": "source-and-ELF", "bounds": [8, 16, 38], "stride": 3},
        {"from": "sAnimatedGraphicsEntries", "to": "gAnimatedGraphicsData", "kind": "load-properties-and-pointer", "status": "source-only-native-consumer", "consumer": "AnimatedGraphicsLoad"},
        {"from": "gAnimatedGraphicsData", "to": "AnimatedGraphicsUpdate", "kind": "signed-frame-counter", "status": "source-only-native-consumer", "stride": 128, "frame_type": "s8", "max_safe_NORMAL_states": 127},
        {"from": "AnimatedGraphicsUpdate", "to": "EWRAM:0x0201b000", "kind": "DMA128-per-slot", "status": "source-only-native-consumer", "slots": 16},
        {"from": "AnimatedGraphicsTransfer", "to": "VRAM:0x06004000", "kind": "DMA128-per-dirty-slot", "status": "source-only-native-consumer", "extra_slot_12_15_mirror": "0x0600fde0..0x0600ffdf"},
        {"from": "RoomUpdateAnimatedGraphicsAndPalettes", "to": "AnimatedGraphicsUpdate", "kind": "gameplay-scheduling", "status": "unresolved-all-callers-and-native-behavior"},
        {"from": "gAnimatedGraphicsEntry.tileset", "to": "sAnimatedTilesetEntries", "kind": "room-config-selector-authority", "status": "unresolved-all-room-inputs"},
    ]


def expansion_plan(snapshot, entry=18, new_count=5):
    """Property plan only: never places data or silently changes shared neighbors."""
    record = snapshot["entries"][entry]
    if record["type"] != 1 or not record["numberOfStates"] < new_count <= 127:
        raise ValueError("Only bounded NORMAL frame expansion is admitted")
    return {"entry": entry, "old_count": record["numberOfStates"], "new_count": new_count,
            "old_bytes": record["numberOfStates"] * 128, "new_bytes": new_count * 128,
            "required_changes": ["separate expanded asset allocation", "descriptor.pGraphics relocation",
                                 "descriptor.numberOfStates", "asset identity and output ROM identity"],
            "unchanged_consumers": ["descriptor8 stride", "frame128 stride", "DMA64 halfwords", "16 runtime slots", "selector entry ID"],
            "source_emission": "replace selected descriptor pGraphics and numberOfStates; emit separate const u8 frame array",
            "guards": ["exact ROM and descriptor preimage", "all original frames retained", "exclusive new allocation proven by producer", "new_count <= 127", "NORMAL type remains1"],
            "blocked_on": ["placement/build authority", "all-callers/native execution qualification"],
            "in_place_growth_allowed": False, "whole_game_safe": None}


def shared_manifest(snapshot, private_dir, rom_size):
    """Adapt the captured family to the guarded common property backend.

    Closure applies only to this copy-on-write frame asset and the sole descriptor
    whose pointer is changed. It does not claim all engine callers are known.
    """
    records = {record["id"]: record for record in snapshot["records"]}
    selected = snapshot["entries"][18]
    origin = records[selected["asset"]]
    frame_offset = origin["rom_offset"] + selected["asset_offset"]
    frame_size = selected["reachable_frame_bytes"]
    allocations = []
    for name, record in records.items():
        if "rom_offset" not in record:
            allocations.append({"id": name, "kind": "data", "address": record["address"],
                                "size": record["size"], "source": "src/globals1.c"})
            continue
        if name == selected["asset"]:
            for suffix, start, size in [("prefix", origin["rom_offset"], selected["asset_offset"]),
                                        ("entry18", frame_offset, frame_size),
                                        ("suffix", frame_offset + frame_size,
                                         origin["size"] - selected["asset_offset"] - frame_size)]:
                allocations.append({"id": name + ":" + suffix, "kind": "data", "rom_offset": start,
                                    "size": size, "source": "src/data/animated_tiles_data.c",
                                    "classification": "source-declared pixel bytes; ELF-captured payload"})
        else:
            allocations.append({"id": name, "kind": "data", "rom_offset": record["rom_offset"],
                                "size": record["size"], "source": "src/data/animated_graphics_data.c" if "Entries" in name else "src/data/animated_tiles_data.c"})
    raw = (Path(private_dir) / (selected["asset"] + ".bin")).read_bytes()[selected["asset_offset"]:selected["asset_offset"] + frame_size]
    fields = [{"name": f"word{i}", "offset": i * 4, "type": "u32"} for i in range(32)]
    rows = [{f"word{i}": struct.unpack_from("<I", raw, frame * 128 + i * 4)[0]
             for i in range(32)} for frame in range(4)]
    descriptor = records["sAnimatedGraphicsEntries"]["rom_offset"] + 18 * 8
    return {"schema": "gameverse.gba-memory-ontology/1", "game_id": snapshot["game_id"],
            "module_id": FAMILY,
            "source_revision": {"source_files": snapshot["source_files"], "elf_sha256": snapshot["elf_sha256"]},
            "rom": {"sha256": snapshot["rom_sha256"], "size": rom_size},
            "allocations": allocations, "typed_layouts": snapshot["layouts"],
            "consumer_dependencies": snapshot["dependencies"],
            "tables": [{"id": "mzm.animation18.frames", "symbol": "MzmAnimation18ExpandedFrames",
                        "allocation_id": "sAnimatedTilesGfx:entry18", "rom_offset": frame_offset,
                        "capacity": 4, "stride": 128, "alignment": 4, "fields": fields,
                        "rows": rows, "snapshot_hex": raw.hex(),
                        "bindings": [{"role": "count", "type": "u8", "rom_offset": descriptor + 2, "expected": 4},
                                     {"role": "pointer", "type": "u32", "rom_offset": descriptor + 4, "expected": selected["pGraphics"]}],
                        "expansion": {"status": "closed", "reference_closure": "complete", "fixed_consumer_capacity": 127,
                                      "closure_scope": "only copy-on-write descriptor18 frame array, not caller lifecycle/native semantics",
                                      "closure_evidence": [
                                          "descriptor18 NORMAL type1; frame count is loaded from descriptor+2 into RAM numberOfStates",
                                          "AnimatedGraphicsUpdate compares currentAnimationFrame to numberOfStates and multiplies selected frame by128",
                                          "AnimatedGraphicsLoad propagates descriptor pGraphics; per-slot DMA always transfers128 bytes",
                                          "only descriptor18 changes; all original shared assets and other descriptor pointers remain unchanged",
                                          "runtime slots remain16 and each state remains12 bytes; no RAM capacity growth",
                                          "new array is a producer-owned extension at exact ROM end, within GBA32MiB mapping; no free-tail inference"],
                                      "free_region": {"mode": "rom_extension", "rom_offset": rom_size, "size": 640,
                                                      "expected_sha256": digest(b""), "fill": 255,
                                                      "provenance": "explicit new deterministic allocation beyond original image; original bytes retained"}}}]}
