"""Reproduce metadata-only composition examples from local pinned GBA captures.

No ROM, compiler, emulator, or external dependency is required. Captures under
``local/`` are private inputs; absence is an explicit error, never a fixture fallback.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import re
import struct
import statistics
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCES = {
    "firered": {
        "partition": "research/ir-workshop/roundtrip-20261016/firered/rev1-roundtrip-001/manifest.json",
        "memory": "local/roundtrip/firered-memory-ontology-003/manifest.json",
        "candidate": "local/roundtrip/firered-memory-ontology-003/expanded/manifest.json",
        "table": "gMonIconPalettes",
    },
    "mzm": {
        "partition": "local/roundtrip/mzm-object-source-v3-20261016/manifest.json",
        "memory": "local/memory-ontology-20261016/mzm/manifest.json",
        "candidate": "local/memory-ontology-20261016/mzm/result-manifest.json",
        "table": "mzm.animation18.frames",
    },
}


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _read(root, relative):
    raw = (root / relative).read_bytes()
    value = json.loads(raw)
    return value, {"path": relative, "sha256": _sha(raw),
                   "canonical_sha256": _sha(_canonical(value)), "size_bytes": len(raw)}


def _partition_summary(manifest):
    """Existing partition parsing baseline: ownership coverage only."""
    cursor = 0
    for component in sorted(manifest["components"], key=lambda c: c["offset"]):
        if component["offset"] != cursor:
            raise ValueError("Partition has a gap or overlap at %s" % cursor)
        cursor += component["size"]
    if cursor != manifest["original"]["size"]:
        raise ValueError("Partition does not cover the original ROM")
    return {"component_count": len(manifest["components"]), "owned_bytes": cursor,
            "rom_size": manifest["original"]["size"], "complete_byte_ownership": True}


def _source_commit(root):
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                            capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def _measure(operation, repeats):
    samples = []
    result = None
    for _ in range(repeats):
        started = time.perf_counter()
        result = operation()
        samples.append(time.perf_counter() - started)
    return result, {"samples_seconds": samples, "median_seconds": statistics.median(samples),
                    "repetitions": repeats, "outcome": "passed"}


def _code_pins(root):
    paths = ["tools/whole_game_composition/core.py",
             "tools/whole_game_composition/reference_examples.py"]
    return [{"path": path, "sha256": _sha((root / path).read_bytes())} for path in paths]


def _write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository containing private captures")
    parser.add_argument("--output", type=Path, required=True, help="New private output directory")
    parser.add_argument("--repeats", type=int, default=3,
                        help="Comparable metadata timing samples, 1 through 20 (default 3)")
    args = parser.parse_args(argv)
    if not 1 <= args.repeats <= 20:
        parser.error("--repeats must be between 1 and 20")
    args.output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    receipt = {
        "schema": "gameverse.whole-game-composition-reference-run/1",
        "run_id": str(uuid.uuid4()), "source_commit": _source_commit(args.root),
        "environment": {"python": sys.version, "platform": platform.platform()},
        "config": {"references": REFERENCES, "repeats": args.repeats},
        "queue_seconds": None, "build_seconds": None, "simulation_seconds": None,
        "evaluation_seconds": None, "attempt_count": 1, "repair_count": 0,
        "cache": "OS filesystem cache uncontrolled; same process and inputs for both paths",
        "timing_scope": "Per-case paired metadata paths; stages are sequential. Total includes file output; per-case timings exclude output and source-code hashing.",
        "limitations": ["Metadata planning only; no candidate ROM is emitted or run.",
                        "Byte ownership is independent of semantic and behavioral closure.",
                        "No build, CI, queue, native rendering or gameplay timings are available."]}
    try:
        receipt["implementation_pins"] = _code_pins(args.root)
        receipt["cases"] = {
            name: run_case(args.root, args.output, name, reference, args.repeats)
            for name, reference in REFERENCES.items()
        }
        receipt["crossgame"] = run_crossgame(args.root, args.output)
        receipt["outcome"] = "passed"
    except Exception as error:
        receipt["outcome"] = "failed"
        receipt["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        receipt["total_seconds"] = time.perf_counter() - started
        _write(args.output / "receipt.json", receipt)
    print(json.dumps({"outcome": receipt["outcome"], "output": str(args.output),
                      "run_id": receipt["run_id"]}, sort_keys=True))
    return 0


def _candidate(host, manifest, manifest_pin, table_id):
    from .core import memory_table_node

    candidate = memory_table_node(manifest, table_id, memory_ref=manifest_pin["path"])
    candidate["id"] = host["id"] + ":expanded-capture"
    candidate["provenance"]["input_file_sha256"] = manifest_pin["sha256"]
    candidate["provenance"]["construction"] = (
        "Actual expanded capture layout; not imported as original-ROM ownership")
    return candidate


def run_case(root, output, name, reference, repeats):
    from .core import import_game, plan_substitution, validate_game

    pins = {kind: _read(root, reference[kind])[1]
            for kind in ("partition", "memory", "candidate")}

    def load_inputs():
        return [json.loads((root / reference[kind]).read_bytes())
                for kind in ("partition", "memory", "candidate")]

    def baseline():
        partition, _memory, _candidate_capture = load_inputs()
        return _partition_summary(partition)

    def full():
        partition, memory, candidate_capture = load_inputs()
        if candidate_capture.get("parent_manifest_sha256") != _sha(_canonical(memory)):
            raise ValueError(name + " expanded capture is not derived from pinned memory input")
        if candidate_capture.get("game_id") != memory.get("game_id"):
            raise ValueError(name + " expanded capture game identity disagrees")
        game = import_game(partition, memory, partition_ref=reference["partition"],
                           memory_ref=reference["memory"])
        audit = validate_game(game, partition)
        host = next(n for n in game["nodes"] if n["id"] == "table:" + reference["table"])
        candidate = _candidate(host, candidate_capture, pins["candidate"], reference["table"])
        constructive = plan_substitution(host, candidate)
        if constructive["classification"] != "adaptable":
            raise ValueError(name + " constructive plan was not adaptable: " + str(constructive))
        cases = {"captured-expansion": {"kind": "actual-capture", "plan": constructive}}
        for key, value in (("stride", host["contract"]["stride"] * 2), ("endian", "big")):
            changed = copy.deepcopy(candidate)
            changed["id"] += ":hypothetical-" + key
            changed["contract"][key] = value
            plan = plan_substitution(host, changed)
            if plan["classification"] != "incompatible":
                raise ValueError(name + " failed to prune " + key)
            cases["reject-" + key] = {"kind": "hypothetical-contradiction-of-captured-contract", "plan": plan}
        fixed = host["contract"]["expansion"]["fixed_consumer_capacity"]
        oversized = copy.deepcopy(candidate)
        oversized["id"] += ":hypothetical-over-capacity"
        oversized["contract"].update(count=fixed + 1, capacity=fixed + 1)
        plan = plan_substitution(host, oversized)
        if plan["classification"] != "incompatible":
            raise ValueError(name + " failed to prune fixed capacity")
        cases["reject-capacity"] = {"kind": "hypothetical-contradiction-of-captured-contract", "plan": plan}
        native = next(n for n in game["nodes"] if n.get("kind") == "component")
        native_plan = plan_substitution(native, copy.deepcopy(native))
        if native_plan["classification"] != "unknown":
            raise ValueError(name + " unresolved native behavior was promoted")
        cases["unresolved-native"] = {"kind": "actual-capture", "plan": native_plan}
        return game, audit, candidate, cases

    ownership, before = _measure(baseline, repeats)
    (game, audit, candidate, cases), after = _measure(full, repeats)
    case_output = output / name
    case_output.mkdir()
    for filename, value in (("game.json", game), ("audit.json", audit),
                            ("candidate.json", candidate), ("plans.json", cases)):
        _write(case_output / filename, value)
    return {"input_pins": pins, "rom": game["rom"], "ownership": ownership,
            "scope": "typed-data-layout planning; graphics appearance and runtime effects unverified",
            "captured_counts": {"before": next(n for n in game["nodes"] if n["id"] == "table:" + reference["table"])["contract"]["count"],
                                "after": candidate["contract"]["count"]},
            "plans": {key: case["plan"]["classification"] for key, case in cases.items()},
            "timing": {"before_partition_parse_and_coverage": before,
                       "after_import_validate_and_five_plans": after,
                       "median_added_seconds": after["median_seconds"] - before["median_seconds"],
                       "comparison": "Same three input files are read and parsed per sample, same process and machine. After additionally imports, validates and plans; import includes an internal validation, so stages must not be summed.",
                       "build_comparison": None},
            "outputs": {key: str(case_output / (key + ".json")) for key in
                        ("game", "audit", "candidate", "plans")}}




def run_crossgame(root, output):
    """Crossgame storage compatibility is explicitly narrower than asset semantics."""
    from .core import plan_substitution

    started = time.perf_counter()
    profile_path = "local/roundtrip/mzm-private-asset-profile-20261016.json"
    profile, profile_pin = _read(root, profile_path)
    asset = next(a for a in profile["source_backed_candidates"]
                 if a["asset_symbol"] == "sSamusPal_PowerSuit_Default")
    asset_raw = (root / asset["source_asset"]).read_bytes()
    if _sha(asset_raw) != asset["source_asset_sha256"]:
        raise ValueError("Stale MZM source palette asset")
    literals = re.fullmatch(rb"\s*(\d+u\s*,\s*)*\d+u\s*,?\s*", asset_raw)
    if literals is None:
        raise ValueError("Unsupported MZM captured literal syntax")
    values = [int(v) for v in re.findall(rb"(\d+)u", asset_raw)]
    packed = b"".join(struct.pack("<H", v) for v in values)
    if len(packed) != asset["exact_size_bytes"] or _sha(packed) != asset["span_sha256"]:
        raise ValueError("MZM palette literals disagree with captured span")
    fr_game = json.loads((output / "firered/game.json").read_text())
    mzm_game = json.loads((output / "mzm/game.json").read_text())
    fr_memory, fr_pin = _read(root, REFERENCES["firered"]["memory"])
    fr_table = next(t for t in fr_memory["tables"] if t["id"] == "gMonIconPalettes")
    if any(f["type"] != "u16" or f["offset"] != 2 * i
           for i, f in enumerate(fr_table["fields"])):
        raise ValueError("FireRed palette is not contiguous u16 storage")
    fr_values = [row[field["name"]] for row in fr_table["rows"] for field in fr_table["fields"]]
    if len(fr_values) != len(values) or len(values) != 48:
        raise ValueError("Crossgame scalar view sizes disagree")
    fr_host = next(n for n in fr_game["nodes"] if n["id"] == "table:gMonIconPalettes")
    scalar = {"scope": "typed-data-layout", "format": "contiguous-u16-storage/1",
              "endian": "little", "pointer_width": 32, "stride": 2, "count": 48,
              "capacity": 48, "fields": [{"name": "value", "type": "u16", "offset": 0}],
              "bindings": [], "expansion": {}, "graphics": [],
              "effects": copy.deepcopy(fr_host["contract"]["effects"])}
    host = {"id": "firered:gMonIconPalettes:u16-storage-view", "kind": "asset-storage-view",
            "contract": scalar, "provenance": {"memory_capture": fr_pin,
                "projection": "flatten three captured rows of sixteen contiguous u16 fields",
                "rom_offset": fr_table["rom_offset"], "size_bytes": 96}}
    candidate = {"id": "mzm:sSamusPal_PowerSuit_Default:u16-storage-view", "kind": "asset-storage-view",
                 "contract": copy.deepcopy(scalar), "provenance": {
                     "profile": profile_pin, "source_asset": asset["source_asset"],
                     "source_asset_sha256": _sha(asset_raw), "span_sha256": _sha(packed),
                     "projection": "48 actual little-endian u16 literals; no palette bank interpretation",
                     "rom_offset": int(asset["original_rom_offset_hex"], 16), "size_bytes": len(packed)}}
    storage_plan = plan_substitution(host, candidate)
    if storage_plan["classification"] != "interchangeable":
        raise ValueError("Crossgame u16 storage interface unexpectedly incompatible")
    mzm_table = next(n for n in mzm_game["nodes"] if n["id"] == "table:mzm.animation18.frames")
    direct_plan = plan_substitution(fr_host, mzm_table)
    native_fr = next(n for n in fr_game["nodes"] if n["kind"] == "component")
    native_mzm = next(n for n in mzm_game["nodes"] if n["kind"] == "component")
    native_plan = plan_substitution(native_fr, native_mzm)
    if direct_plan["classification"] != "incompatible" or native_plan["classification"] != "unknown":
        raise ValueError("Crossgame direct/native contracts unexpectedly promoted")
    branches = {}
    for key, descriptor in {
        "unsupported-bpp": {"kind": "gba-tile-transfer/1", "bpp": 3,
                            "destination_offset": 0, "copy_bytes": 128},
        "vram-overflow": {"kind": "gba-tile-transfer/1", "bpp": 4,
                          "destination_offset": 65504, "copy_bytes": 128},
    }.items():
        changed = copy.deepcopy(candidate)
        changed["id"] += ":hypothetical-" + key
        changed["contract"]["graphics"] = [descriptor]
        branches[key] = {"kind": "hypothetical-invalid-graphics-contract",
                         "plan": plan_substitution(host, changed)}
        if branches[key]["plan"]["classification"] != "incompatible":
            raise ValueError("Invalid graphics branch was not rejected")
    result = {"schema": "gameverse.crossgame-storage-reference/1", "input_pins": [profile_pin, fr_pin],
              "host": host, "candidate": candidate, "storage_plan": storage_plan,
              "direct_palette_to_frame_plan": direct_plan, "native_crossgame_plan": native_plan,
              "graphics_negative_branches": branches,
              "missing_evidence": ["Crossgame color semantics and palette bank selection",
                  "Consumer pointer bindings and transplant write admission", "Native ABI and state ownership",
                  "Runtime initialization, phase order and scheduler closure", "Save compatibility and gameplay"],
              "claims": {"u16_storage_interface_only": True, "graphics_interchangeable": False,
                         "native_play_verified": False, "runnable_mashup": False},
              "outcome": "passed"}
    _write(output / "crossgame.json", result)
    return {"output": str(output / "crossgame.json"), "input_pins": [profile_pin, fr_pin],
            "storage_classification": storage_plan["classification"],
            "native_classification": native_plan["classification"],
            "direct_palette_to_frame_classification": direct_plan["classification"],
            "duration_seconds": time.perf_counter() - started,
            "scope": "Actual shared u16 storage; graphics and gameplay unresolved"}


if __name__ == "__main__":
    raise SystemExit(main())
