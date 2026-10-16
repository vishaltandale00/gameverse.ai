"""Pinned ELF/map ownership capture without claiming regenerated semantics."""
from __future__ import annotations
import json
from pathlib import Path
import platform
import re
import struct
import time
from .reassemble import MAX_IMAGE_BYTES, integer, sha

SCHEMA = "gameverse.elf-capture-profile/1"


def pinned(profile_root, record, limit):
    path = (profile_root / record["path"]).resolve()
    if not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError("Missing or oversized pinned input: " + str(path))
    data = path.read_bytes()
    if sha(data) != record["sha256"]:
        raise ValueError("Pinned input hash mismatch: " + str(path))
    return path, data


def load_segments(elf):
    if len(elf) < 52 or elf[:6] != b"\x7fELF\x01\x01":
        raise ValueError("Expected 32-bit little-endian ELF")
    header = struct.unpack_from("<16sHHIIIIIHHHHHH", elf)
    if header[2] != 40:
        raise ValueError("Expected ARM ELF")
    phoff, phsize, count = header[5], header[9], header[10]
    if phsize < 32 or count > 256 or phoff + count * phsize > len(elf):
        raise ValueError("Invalid ELF program header bounds")
    segments = []
    for index in range(count):
        kind, offset, virtual, physical, size, memory, flags, alignment = struct.unpack_from("<IIIIIIII", elf, phoff + index * phsize)
        if kind != 1 or not size:
            continue
        if size > memory or offset + size > len(elf):
            raise ValueError("Invalid file-backed ELF segment")
        segments.append({"file_offset": offset, "virtual": virtual, "physical": physical, "size": size})
    return segments


def input_sections(text):
    """GNU ld input sections, including wrapped section/address rows."""
    inline = re.compile(r"^ (\.[^\s]+)[ \t]+(0x[0-9a-fA-F]+)[ \t]+(0x[0-9a-fA-F]+)[ \t]+(.+?)\s*$")
    section_only = re.compile(r"^ (\.[^\s]+)\s*$")
    address_only = re.compile(r"^[ \t]+(0x[0-9a-fA-F]+)[ \t]+(0x[0-9a-fA-F]+)[ \t]+(.+?)\s*$")
    pending = None
    rows = []
    for line in text.splitlines():
        match = inline.match(line)
        if match:
            section, address, size, owner = match.groups()
        else:
            match = section_only.match(line)
            if match:
                pending = match.group(1)
                continue
            match = address_only.match(line)
            if pending and match:
                section, (address, size, owner) = pending, match.groups()
            else:
                pending = None
                continue
        pending = None
        if not (owner.endswith(".o") or re.search(r"\.a\([^()]+\.o\)$", owner)):
            continue
        if section.startswith((".bss", ".sbss", ".noinit", ".pseudo")):
            continue
        size = int(size, 16)
        if size:
            rows.append({"section": section, "address": int(address, 16), "size": size, "owner": owner})
    return rows


def safe_id(value):
    value = re.sub(r"[^A-Za-z0-9_.-]", "_", value)
    return value if len(value) <= 150 else value[:120] + "." + sha(value.encode())[:20]


def capture_sections(text, original, elf, *, rom_base, game_id, exceptions=()):
    """Return exact ownership spans; explicit exceptions split opaque subranges."""
    segments = load_segments(elf)
    results, skipped, mismatches = [], [], []
    for row in input_sections(text):
        address, size = row["address"], row["size"]
        matches = [s for s in segments if s["virtual"] <= address and address + size <= s["virtual"] + s["size"]]
        if len(matches) != 1:
            if rom_base <= address < rom_base + len(original):
                raise ValueError("ROM map section lacks unique file-backed ELF segment: " + str(row))
            skipped.append(row)
            continue
        segment = matches[0]
        physical = segment["physical"] + address - segment["virtual"]
        offset = physical - rom_base
        if offset < 0 or offset >= len(original):
            skipped.append(row)
            continue
        if offset + size > len(original):
            raise ValueError("ROM object extends outside original")
        file_offset = segment["file_offset"] + address - segment["virtual"]
        linked = elf[file_offset:file_offset + size]
        raw = original[offset:offset + size]
        different = [offset + i for i, (a, b) in enumerate(zip(linked, raw)) if a != b]
        for position in different:
            if not any(e["offset"] <= position < e["offset"] + e["size"] for e in exceptions):
                raise ValueError("Unexplained ELF/original mismatch at " + hex(position) + ": " + row["owner"])
        boundaries = {offset, offset + size}
        for exception in exceptions:
            start, end = max(offset, exception["offset"]), min(offset + size, exception["offset"] + exception["size"])
            if start < end:
                boundaries.update((start, end))
        boundaries = sorted(boundaries)
        for start, end in zip(boundaries, boundaries[1:]):
            changed = any(start <= point < end for point in different)
            reasons = [e["reason"] for e in exceptions if e["offset"] <= start and end <= e["offset"] + e["size"]]
            contract = {"object": row["owner"], "section": row["section"], "virtual_address": address + start - offset,
                        "physical_address": rom_base + start, "rom_to_ram_copy": physical != address,
                        "linked_elf_matches_original": not changed, "native_abi": "unknown",
                        "address_assumptions": "Original linked addresses retained", "semantic_boundaries": "Unresolved source/object ownership"}
            if changed:
                contract["postprocessing"] = reasons
                mismatches.append({"offset": start, "size": end - start, "different_bytes": sum(start <= p < end for p in different), "reasons": reasons})
            results.append({"id": safe_id(game_id + ".object." + row["owner"] + row["section"] + f".{start:08x}"),
                            "offset": start, "size": end - start, "stratum": "opaque-preserved" if changed else "object-captured",
                            "provider": {"kind": "opaque_bytes", "capture_kind": "linker-object-section"},
                            "contract": contract, "dependencies": [], "relocations": [],
                            "closure": {"status": "unknown", "reason": "Ownership captured; logical component boundaries and semantic dependency closure remain unresolved"}})
    results.sort(key=lambda r: r["offset"])
    for previous, current in zip(results, results[1:]):
        if previous["offset"] + previous["size"] > current["offset"]:
            raise ValueError("Overlapping linker object ownership")
    if not results:
        raise ValueError("No file-backed ROM object ownership found")
    if len(results) > 4096:
        raise ValueError("Object capture exceeds bounded component count")
    return results, skipped, mismatches


def prepare_elf_profile(profile_path, output_dir):
    """Validate pinned inputs and emit a profile for the existing exact extractor."""
    start = time.perf_counter()
    profile_path, output_dir = Path(profile_path).resolve(), Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=False)
    receipt = {"schema": "gameverse.elf-capture-receipt/1", "status": "running", "build_seconds": None,
               "queue_seconds": None, "mode": "existing-pinned-elf-map-capture", "source_regenerated_bytes": 0,
               "machine": {"platform": platform.platform(), "python": platform.python_version()}}
    try:
        config_raw = profile_path.read_bytes()
        config = json.loads(config_raw)
        if config.get("schema") != SCHEMA:
            raise ValueError("Unsupported pinned ELF profile")
        base = integer(config["rom_base"], "ROM base")
        original_path, original = pinned(profile_path.parent, config["original"], MAX_IMAGE_BYTES)
        if base < 0 or base + len(original) > 0x100000000:
            raise ValueError("ROM address range exceeds the 32-bit address space")
        elf_path, elf = pinned(profile_path.parent, config["elf"], 256 * 1024 * 1024)
        map_path, mapping = pinned(profile_path.parent, config["map"], 64 * 1024 * 1024)
        exceptions = config.get("header_postprocessing", {}).get("ranges", [])
        for exception in exceptions:
            offset, size = integer(exception["offset"], "Exception offset"), integer(exception["size"], "Exception size")
            if offset < 0 or size <= 0 or offset + size > len(original) or not exception.get("reason"):
                raise ValueError("Invalid explicit postprocessing exception")
        components, skipped, mismatches = capture_sections(mapping.decode(), original, elf, rom_base=base, game_id=config["game_id"], exceptions=exceptions)
        source_root = (profile_path.parent / config["source_root"]).resolve() if config.get("source_root") else None
        source_cache = {}
        for component in components:
            if source_root:
                owner = component["contract"]["object"]
                for suffix in (".c", ".s"):
                    source = (source_root / owner).with_suffix(suffix).resolve()
                    if source.is_relative_to(source_root) and source.is_file():
                        if source not in source_cache:
                            source_cache[source] = sha(source.read_bytes())
                        component["contract"]["source"] = str(source)
                        component["contract"]["source_sha256"] = source_cache[source]
                        break
        (output_dir / "input-profile.json").write_bytes(config_raw)
        (output_dir / "link-map.txt").write_bytes(mapping)
        evidence = [{"path": "input-profile.json", "sha256": sha(config_raw)}, {"path": "link-map.txt", "sha256": sha(mapping)}]
        for index, record in enumerate(config.get("evidence", [])):
            path, data = pinned(profile_path.parent, record, 64 * 1024 * 1024)
            name = f"upstream-evidence-{index}" + path.suffix
            (output_dir / name).write_bytes(data)
            evidence.append({"path": name, "sha256": sha(data)})
        receipt.update({"status": "passed", "original": {"path": str(original_path), "sha256": sha(original), "size": len(original)},
                        "elf": {"path": str(elf_path), "sha256": sha(elf)}, "map": {"path": str(map_path), "sha256": sha(mapping)},
                        "profile_sha256": sha(config_raw), "game_id": config["game_id"], "rom_base": base,
                        "object_sections": len(components), "object_captured_bytes": sum(c["size"] for c in components if c["stratum"] == "object-captured"),
                        "explicit_postprocessed_ranges": mismatches, "non_rom_sections_skipped": skipped,
                        "semantic_closure": "unknown", "logical_prefabs_closed": 0})
        receipt["provider_seconds"] = time.perf_counter() - start
        (output_dir / "provider-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        evidence.append({"path": "provider-receipt.json", "sha256": sha((output_dir / "provider-receipt.json").read_bytes())})
        groups = {}
        for component in components:
            component["evidence"] = evidence
            groups.setdefault(component["contract"]["object"], []).append(component["id"])
        prefabs = [{"id": safe_id(config["game_id"] + ".ownership." + owner), "kind": "source-object-ownership-group",
                    "components": members, "prefabs": [], "dependencies": [],
                    "closure": {"status": "unknown", "reason": "Source ownership scaffolding, not closed gameplay prefab"}}
                   for owner, members in sorted(groups.items())]
        profile = {"original_sha256": sha(original), "address_base": base, "components": components, "prefabs": prefabs}
        target = output_dir / "profile.json"
        target.write_text(json.dumps(profile, indent=2, sort_keys=True) + "\n")
        return target, receipt
    except Exception as error:
        receipt.update({"status": "failed", "error": str(error), "provider_seconds": time.perf_counter() - start})
        (output_dir / "provider-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        raise
