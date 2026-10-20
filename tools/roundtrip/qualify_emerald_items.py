"""Qualify the original linked item clamp and held-item metadata readers.

Only serialized own-ROM HighFunction is compiler input. Source and ELF witnesses
attribute the results; no authored implementation of item behavior is compiled.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/behavior_ir"))
from lift import Lifter
from lower import lower
from qualify import qualify
from .source_provider import elf_range

ROM = ROOT / "local/roms/Pokemon - Emerald Version (USA, Europe).gba"
ROM_SHA256 = "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af"
L0 = ROOT / "local/ir/fleet-next/pokemon-emerald-version/exact-export-EX027/l0"
SOURCE = ROOT / "local/whole-game-mashup/emerald-firered/builds/emerald/20261016T162445Z-aeb9cae75002/source"
TARGETS = [("clamp", "080d745c"), ("effect", "080d74dc"), ("parameter", "080d7500")]


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def run(output, vectors=4096, reuse_clamp=None, static_only=False):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    context = {"run_id": output.name, "source_commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), "machine": platform.platform(),
        "python": sys.version, "recipe_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "cache": "clean parent compilation; explicitly authenticated unchanged clamp proof when supplied",
        "queue_seconds": None, "vectors": vectors}
    raw = ROM.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ROM_SHA256:
        raise ValueError("Exact pinned Emerald original required")
    source_item, source_map = SOURCE / "src/item.c", SOURCE / "pokeemerald.map"
    if "0x085839a0                gItems" not in source_map.read_text():
        raise ValueError("Pinned original ARM map does not attest expected item table")
    # This is an ABI boundary witness, not a replacement behavior program.
    # The exact finite instruction pattern has two return paths: move the
    # zero-extended r1 value or MOV r0,#0; both restore the saved LR through r1.
    code = raw[0xd745c:0xd7474]
    expected = [0xb500, 0x0400, 0x0c01, 0x20bc, 0x0040, 0x4281,
                0xd801, 0x1c08, 0xe000, 0x2000, 0xbc02, 0x4708]
    if [int.from_bytes(code[i:i+2], "little") for i in range(0, len(code), 2)] != expected:
        raise ValueError("Original clamp unsigned-return instruction witness changed")
    if elf_range((SOURCE / "pokeemerald.elf").read_bytes(), 0x080d745c, len(code)) != code:
        raise ValueError("Linked ELF clamp return witness differs from original ROM")
    witness_path = output / "clamp-return-abi.json"
    save(witness_path, {"kind": "exact_pinned_thumb_unsigned_return_extension", "original_sha256": ROM_SHA256,
                       "entry": "080d745c", "size": 24, "bytes_hex": code.hex(),
                       "sha256": hashlib.sha256(code).hexdigest(), "unsigned_extension": "u32",
                       "method": "Exact checked12-halfword straight-line/two-branch instruction template; no calls or memory accesses beyond balanced saved LR",
                       "return_paths": [{"path": "BHI not taken; ADD r0,r1,#0", "range": [0, 376],
                                         "basis": "LSL r0,#16 then LSR r1,#16 clears high16; CMP/BHI constrains copied value"},
                                        {"path": "BHI taken; MOV r0,#0", "range": [0, 0]}],
                       "return_frame": "PUSH{lr}; both paths converge POP{r1}; BX r1", "native_sampling_used_as_proof": False})
    def clamp_dependency(behavior, adapter, directory):
        bound = copy.deepcopy(adapter)
        bound["return_abi"] = {"unsigned_extension": "u32", "evidence": [{
            "path": str(witness_path.relative_to(ROOT)), "sha256": hashlib.sha256(witness_path.read_bytes()).hexdigest(),
            "scope": "Source-ROM/ELF exact machine unsigned-extension witness; original frozen native adapter and L1 unchanged"}]}
        save(directory / "dependency-adapter.json", bound)
        return behavior, bound
    call_links = []
    for parent in ("080d74dc", "080d7500", "0803cf10"):
        source_l0 = json.loads((L0 / (parent + ".json")).read_text())
        nodes = {node["id"]: node for node in source_l0["varnodes"]}
        for block in source_l0["blocks"]:
            for op in block["ops"]:
                if op["opcode"] != "CALL":
                    continue
                target = int(nodes[op["inputs"][0]]["offset"])
                if target not in (0x080d745c, 0x080d74dc, 0x080d7500):
                    continue
                pc = int(op["pc"], 16)
                instruction = raw[pc-0x08000000:pc-0x08000000+4]
                first, second = int.from_bytes(instruction[:2], "little"), int.from_bytes(instruction[2:], "little")
                delta = first & 2047
                delta = delta - 2048 if delta & 1024 else delta
                actual = (pc + 4 + delta * 4096 + (second & 2047) * 2) & 0xffffffff
                if first & 0xf800 != 0xf000 or second & 0xf800 != 0xf800 or actual != target:
                    raise ValueError("Source SSA call does not match original Thumb BL")
                call_links.append({"parent": parent, "callee": f"{target:08x}", "pc": f"{pc:08x}",
                                   "bytes_hex": instruction.hex(), "sha256": hashlib.sha256(instruction).hexdigest()})
    save(output / "source-layout-evidence.json", {
        "kind": "source_and_original_linked_ARM_layout_validation_oracle",
        "sources": [{"path": str(p.relative_to(ROOT)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                    for p in (source_item, source_map, SOURCE / "pokeemerald.elf",
                              SOURCE / "src/data/items.h", SOURCE / "include/constants/items.h",
                              SOURCE / "include/constants/hold_effects.h", SOURCE / "src/battle_main.c")],
        "source_lines": [865, 897], "table": {"address": 0x085839a0, "record_count": 377,
        "record_stride": 44, "effect_offset": 18, "parameter_offset": 19,
        "size": 377 * 44, "sha256": hashlib.sha256(raw[0x5839a0:0x5839a0+377*44]).hexdigest()},
        "source_consumer": {"path": "src/battle_main.c", "lines": [4627, 4670],
                            "observed_use": "Normal held-item metadata before Macho Brace speed division and Quick Claw shared-roll gate; Enigma Berry uses separate retained host storage"},
        "original_thumb_call_links": call_links, "behavior_compiler_input": False})
    compiled, rows = {}, []
    try:
        for label, entry in TARGETS:
            stage = time.perf_counter()
            directory = output / label
            if label == "clamp" and reuse_clamp is not None:
                frozen = Path(reuse_clamp).resolve()
                proof = json.loads((frozen / "receipt.json").read_text())
                behavior = json.loads((frozen / "l1.json").read_text())
                adapter = json.loads((frozen / "validation-adapter.json").read_text())
                if proof["outcome"] != "pass" or proof["rom_sha256"] != ROM_SHA256:
                    raise ValueError("Invalid frozen clamp native proof")
                for name in ("l1.json", "validation-adapter.json", "generated.c"):
                    if hashlib.sha256((frozen / name).read_bytes()).hexdigest() != proof["artifacts"][name]["sha256"]:
                        raise ValueError("Changed frozen clamp artifact")
                if lower(behavior) != (frozen / "generated.c").read_text() or (frozen / "l0.json").read_bytes() != (L0 / (entry + ".json")).read_bytes():
                    raise ValueError("Frozen clamp source/lowering identity changed")
                shutil.copytree(frozen, directory)
                compiled[entry] = clamp_dependency(behavior, adapter, directory)
                rows.append({"label": label, "entry": entry, "outcome": "reused-unchanged-native-proof",
                             "source_proof": str(frozen / "receipt.json"), "seconds": time.perf_counter() - stage})
                continue
            directory.mkdir()
            source = L0 / (entry + ".json")
            l0 = json.loads(source.read_text())
            behavior, adapter = Lifter(l0, raw, compiled).build()
            compiled[entry] = (behavior, adapter)
            shutil.copy2(source, directory / "l0.json")
            save(directory / "l1.json", behavior)
            save(directory / "validation-adapter.json", adapter)
            (directory / "generated.c").write_text(lower(behavior))
            # Validation oracle only: the pinned ARM layout is 377 records of
            # 44 bytes, with held effect at+18 and parameter at+19. Exercise
            # every legal item plus the first invalid value and u16 maximum.
            # These expectations are never passed to the lifter or lowerer.
            items = list(range(377)) + [377, 65535]
            expected = ([i if i < 377 else 0 for i in items] if label == "clamp" else
                        [raw[0x5839a0 + (i if i < 377 else 0) * 44 +
                             (18 if label == "effect" else 19)] for i in items])
            fixtures = {"parameter_values": [{adapter["parameters"][0]["name"]: i} for i in items],
                        "expected_returns": expected,
                        "context": {"scope": "All377 legal item identities and invalid377/65535; additional synthetic native vectors",
                                    "item_table_address": "0x085839a0", "record_stride": 44,
                                    "table_sha256": hashlib.sha256(raw[0x5839a0:0x5839a0+377*44]).hexdigest(),
                                    "oracle_role": "Source/map-attributed ARM-layout expectations; never behavior compiler input"}}
            save(directory / "fixtures.json", fixtures)
            if static_only:
                rows.append({"label": label, "entry": entry, "outcome": "static-only-not-native-qualified",
                             "seconds": time.perf_counter() - stage, "assets": adapter["assets"]})
                if label == "clamp":
                    compiled[entry] = clamp_dependency(behavior, adapter, directory)
                continue
            proof = qualify(directory, ROM, vectors, True, fixtures)
            if proof["outcome"] != "pass":
                raise ValueError("Original native parity failed: " + label + ": " + str(proof.get("error")))
            save(directory / "package.json", {
                "schema": "gameverse.executable-component/0.2", "id": "emerald.items." + label,
                "origin": "automatic_highfunction_lift", "behavior": "l1.json",
                "behavior_sha256": hashlib.sha256((directory / "l1.json").read_bytes()).hexdigest(),
                "qualification": {"status": "pass", "receipt": "receipt.json", "vectors": vectors},
                "semantic_ports": {"input": {"name": "itemId", "storage_type": "u16",
                                    "frame": "emerald.item_identity", "domain": [0, 65535],
                                    "invalid_item_policy": "IDs377..65535 select item0"},
                                   "output": {"name": {"clamp": "sanitizedItemId", "effect": "heldEffectKind",
                                                       "parameter": "heldEffectParameter"}[label],
                                              "storage_type": adapter["return_type"],
                                              "meaning": "Source identity enum" if label == "effect" else
                                                         "Item-specific unsigned metadata byte; broader physical unit unknown" if label == "parameter" else
                                                         "Valid item table index0..376"}},
                "dependency_closure": "bounded_original_function_with_immutable_item_table",
                "whole_game_equivalent": None})
            rows.append({"label": label, "entry": entry, "outcome": "pass",
                         "seconds": time.perf_counter() - stage, "assets": adapter["assets"],
                         "source_l0_sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
            if label == "clamp":
                compiled[entry] = clamp_dependency(behavior, adapter, directory)
            save(output / "progress.json", {"rows": rows})
    except Exception as error:
        save(output / "result.json", {"outcome": "failed", "error": repr(error), "rows": rows,
                                     "seconds": time.perf_counter() - started, "context": context})
        raise
    result = {"outcome": "static-only" if static_only else "pass", "rows": rows, "seconds": time.perf_counter() - started,
              "original_sha256": ROM_SHA256, "queue_seconds": None,
              "context": context,
              "scope": "Linked item clamp and metadata readers only; battle scheduling and item effects execution remain open"}
    save(output / "result.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vectors", type=int, default=4096)
    parser.add_argument("--reuse-clamp", type=Path)
    parser.add_argument("--static-only", action="store_true")
    args = parser.parse_args()
    result = run(args.output, args.vectors, args.reuse_clamp, args.static_only)
    print(json.dumps({"outcome": result["outcome"], "seconds": result["seconds"],
                      "result": str(args.output / "result.json")}, indent=2))
