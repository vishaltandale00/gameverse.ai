"""Bounded known-source MZM component regeneration through its existing compiler.

This is source regeneration, not recovered behavior IR. Resolved bytes come from
the freshly linked ELF load segment, never from the original cartridge.
"""
from __future__ import annotations
import json
from pathlib import Path
import platform
import re
import struct
import subprocess
import time
from .reassemble import sha

SYMBOL = "SamusUpdateDrawDistanceAndStandingStatus"


def map_objects(text, original, elf, source_tree):
    """Identify file-backed linker input sections, without inventing logical closure."""
    result = []
    pattern = re.compile(r"^ (\.[A-Za-z0-9_.]+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(.+)$", re.MULTILINE)
    for section, start, length, owner in pattern.findall(text):
        address, size = int(start, 16), int(length, 16)
        offset = address - 0x08000000
        if not size or offset < 0 or offset + size > len(original):
            continue
        # Only actual object/archive input lines, not linker expressions.
        if not (owner.endswith(".o") or re.search(r"\.a\([^()]+\.o\)$", owner)):
            continue
        captured = original[offset:offset + size]
        linked_match = elf_range(elf, address, size) == captured
        if not linked_match and owner != "asm/romheader.o":
            raise ValueError("Link-map component differs from original: " + owner)
        name = "mzm.object." + re.sub(r"[^A-Za-z0-9_.-]", "_", owner) + section + f".{offset:08x}"
        contract = {"object": owner, "section": section, "address_assumptions": "Original linked placement retained",
                    "native_abi": "unknown", "linked_elf_matches_original": linked_match,
                    "semantic_boundaries": "Unresolved; linker ownership is not logical prefab closure"}
        if not linked_match:
            contract["postprocessing"] = "Original GBA header retained; pre-gbafix ELF header differs"
        object_path = source_tree / owner
        if object_path.is_file():
            contract["object_sha256"] = sha(object_path.read_bytes())
        source_path = object_path.with_suffix(".c")
        if not source_path.is_file():
            source_path = object_path.with_suffix(".s")
        if source_path.is_file():
            contract["source"] = str(source_path)
            contract["source_sha256"] = sha(source_path.read_bytes())
        result.append({"id": name, "offset": offset, "size": size, "stratum": "object-captured" if linked_match else "opaque-preserved",
                       "provider": {"kind": "opaque_bytes", "capture_kind": "linker-object-section"}, "contract": contract,
                       "closure": {"status": "unknown", "reason": "Object section ownership captured; logical component boundaries, assets and dependencies not independently closed"}})
    result.sort(key=lambda row: row["offset"])
    for previous, current in zip(result, result[1:]):
        if previous["offset"] + previous["size"] > current["offset"]:
            raise ValueError("Overlapping linker ownership records")
    return result


def elf_range(elf, address, size):
    if elf[:6] != b"\x7fELF\x01\x01":
        raise ValueError("Expected 32-bit little-endian ELF")
    header = struct.unpack_from("<16sHHIIIIIHHHHHH", elf)
    if header[2] != 40:
        raise ValueError("Expected ARM ELF")
    phoff, phsize, count = header[5], header[9], header[10]
    matches = []
    for index in range(count):
        kind, offset, virtual, physical, file_size, memory_size, flags, align = struct.unpack_from("<IIIIIIII", elf, phoff + index * phsize)
        if kind == 1 and physical <= address and address + size <= physical + file_size:
            matches.append(elf[offset + address - physical:offset + address - physical + size])
    if len(matches) != 1 or len(matches[0]) != size:
        raise ValueError("ELF range must belong to one file-backed load segment")
    return matches[0]


def regenerate_mzm(source_tree, original, output):
    source_tree, original, output = Path(source_tree).resolve(), Path(original).resolve(), Path(output)
    output.mkdir(parents=True, exist_ok=False)
    source = source_tree / "src/samus.c"
    source_hash = sha(source.read_bytes())
    original_hash = sha(original.read_bytes())
    command = ["make", "-W", "src/samus.c", "CPP=tools/cpp-wrapper", "mzm_us.elf"]
    start = time.perf_counter()
    run = subprocess.run(command, cwd=source_tree, capture_output=True, text=True, timeout=60)
    duration = time.perf_counter() - start
    (output / "build.log").write_text(run.stdout + run.stderr)
    receipt = {"schema": "gameverse.source-component-build/1", "command": command,
               "cwd": str(source_tree), "build_seconds": duration, "outcome": "pass" if run.returncode == 0 else "fail",
               "mode": "forced-one-translation-unit-and-link", "cache": "existing-compiler-assets-and-other-objects-warm",
               "queue_seconds": None, "timeout_seconds": 60, "source_sha256": source_hash,
               "original_sha256": original_hash, "platform": platform.platform(),
               "qualification": "Exact component bytes; semantic dependency closure remains unknown"}
    (output / "build-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    if run.returncode:
        raise ValueError("Existing MZM source compiler failed; see build.log")
    if sha(source.read_bytes()) != source_hash or sha(original.read_bytes()) != original_hash:
        raise ValueError("Immutable source/original changed during build")
    symbols = subprocess.run(["arm-none-eabi-nm", "-S", str(source_tree / "mzm_us.elf")], capture_output=True, text=True, check=True, timeout=10).stdout
    rows = [r.split() for r in symbols.splitlines() if r.split()[-1:] == [SYMBOL]]
    if len(rows) != 1:
        raise ValueError("Expected unique source function symbol")
    address, size = int(rows[0][0], 16), int(rows[0][1], 16)
    elf = (source_tree / "mzm_us.elf").read_bytes()
    data = elf_range(elf, address, size)
    offset = address - 0x08000000
    if offset < 0 or original.read_bytes()[offset:offset + size] != data:
        raise ValueError("Fresh linked source component differs from original")
    (output / "samus-draw-distance.bin").write_bytes(data)
    receipt.update({"elf_sha256": sha(elf), "symbol": SYMBOL, "address": address, "bytes": size, "artifact_sha256": sha(data)})
    (output / "build-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    map_data = (source_tree / "mzm_us.map").read_bytes()
    map_hash = sha(map_data)
    (output / "link-map.txt").write_bytes(map_data)
    profile = {"original_sha256": original_hash, "components": [{
        "id": "mzm.samus.draw-distance", "version": "source-sha256:" + source_hash,
        "offset": offset, "size": size, "stratum": "source-regenerated",
        "provider": {"kind": "source_generated", "generated_artifact": {"path": "samus-draw-distance.bin", "sha256": sha(data)},
                     "recipe": {"command": command, "source": str(source), "source_sha256": source_hash,
                                "elf_sha256": sha(elf), "symbol": SYMBOL, "recipe_version": "mzm-existing-make/1"}},
        "closure": {"status": "unknown", "reason": "Known function source; collision/hitbox table, type-layout and caller dependencies preserved at original addresses but not independently closed"},
        "contract": {"entrypoints": [address | 1], "native_abi": "ARM7TDMI Thumb; void(SamusData*,SamusPhysics*)",
                     "address_assumptions": "Original linked addresses and literal pool retained; no relocation",
                     "state_ownership": "Writes SamusPhysics hitbox and conditionally SamusData.standingStatus",
                     "call_targets": [], "asset_mode": "original-addressed-tables", "dispatch": "original-callers", "scheduling": "original-samus-tick"},
        "dependencies": [], "relocations": [], "evidence": [
            {"path": name, "sha256": sha((output / name).read_bytes())}
            for name in ("build-receipt.json", "build.log", "link-map.txt")] }]}
    function = profile["components"][0]
    objects = map_objects(map_data.decode(), original.read_bytes(), elf, source_tree)
    pieces = []
    for row in objects:
        # Split the containing object at the separately regenerated function.
        boundaries = [(row["offset"], row["offset"] + row["size"])]
        if row["offset"] <= offset < row["offset"] + row["size"]:
            boundaries = [(row["offset"], offset), (offset + size, row["offset"] + row["size"])]
        for begin, end in boundaries:
            if begin == end:
                continue
            piece = dict(row, offset=begin, size=end - begin)
            if begin != row["offset"] or end != row["offset"] + row["size"]:
                piece["id"] += f".fragment-{begin:08x}"
            piece["evidence"] = [{"path": "link-map.txt", "sha256": map_hash}]
            pieces.append(piece)
    profile["components"].extend(pieces)
    groups = {}
    for piece in pieces:
        owner = piece["contract"]["object"]
        groups.setdefault(owner, []).append(piece["id"])
    groups.setdefault("src/samus.o", []).append(function["id"])
    profile["prefabs"] = [{"id": "mzm.ownership-group." + re.sub(r"[^A-Za-z0-9_.-]", "_", owner),
                           "components": names, "prefabs": [], "dependencies": [],
                           "kind": "source-object-ownership-group", "closure": {"status": "unknown", "reason": "Grouping is source ownership, not a closed logical prefab"}}
                          for owner, names in sorted(groups.items())]
    # Pin the actual known data references into their captured owner sections.
    for target_address in (0x08239464, 0x0823A534):
        targets = [r for r in pieces if r["offset"] <= target_address - 0x08000000 < r["offset"] + r["size"]]
        if len(targets) != 1:
            raise ValueError("Expected unique captured owner for Samus table")
        target = targets[0]
        payload = original.read_bytes()[target["offset"]:target["offset"] + target["size"]]
        function["dependencies"].append({"target": target["id"], "sha256": sha(payload), "kind": "literal-table-read",
                                         "status": "resolved", "address": target_address})
    inventory = {"schema": "gameverse.linker-component-inventory/1", "map_sha256": map_hash,
                 "elf_sha256": sha(elf), "object_section_count": len(objects), "object_section_bytes": sum(r["size"] for r in objects),
                 "source_regenerated_bytes": size, "logical_semantic_closure": "unknown",
                 "components": [{"id": r["id"], "offset": r["offset"], "size": r["size"], "contract": r["contract"]} for r in objects]}
    (output / "component-inventory.json").write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n")
    (output / "profile.json").write_text(json.dumps(profile, indent=2, sort_keys=True) + "\n")
    return output / "profile.json", receipt
