"""Pinned Pokémon profiles for the shared automatic-IR reconstruction provider.

These are internal retained-host component substitutions, not whole-game IR or
portable gameplay prefabs. Both cartridge digest algorithms are explicit.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

from .ir_provider import run


PROFILES = {
    "emerald-items": {
        "id": "emerald-held-item-metadata-ir/1",
        "original_sha256": "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af",
        "original_sha1": "f3ae088181bf583e55daf962a92bb46f4f1d07b7",
        "targets": [("clamp", "emerald.items.clamp", "080d745c"),
                    ("effect", "emerald.items.effect", "080d74dc"),
                    ("parameter", "emerald.items.parameter", "080d7500")],
        "package_roots": {"emerald.items." + label: "local/ir/pokemon-next-20261016/items001/" + label
                          for label in ("clamp", "effect", "parameter")},
        "retained_ir": True,
        "reuse_original_proof": True,
        "arena_append": True, "arena_address": 0x09000000, "arena_capacity": 65536,
        "arena_entry": None,
        "scope": "Dependency-linked item ID clamp and immutable held-item metadata readers; battle comparator and scheduler remain open",
        "dependency_frontier": {
            "path": "research/ir-workshop/roundtrip-20261016/wave2/frontier/emerald-item-consumers-v2.json",
            "sha256": "a06a5225a35ac055924b28134af9f53b60733edbbe4b0157cb094c97e9a1b886"},
        "system_contract": "research/deep-extraction/resume/pokemon-emerald-version/next-extraction/system.json",
        "open_dependencies": ["Original battle comparator0803cf10 consumes effect/parameter; full comparator blocked by weather/party-record dispatch",
                              "Original action scheduler0803d2e8 remains blocked by bounded expansion budget",
                              "Item effect execution, held-item ownership, bag/save lifecycle and full battle semantics remain retained host responsibilities"],
    },
    "emerald": {
        "id": "emerald-battle-internals-ir/1",
        "original_sha256": "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af",
        "original_sha1": "f3ae088181bf583e55daf962a92bb46f4f1d07b7",
        "targets": [("side", "emerald.battle.side_lookup", "080a6a30"),
                    ("swap", "emerald.battle.paired_order_swap", "0803cedc")],
        "retained_ir": True,
        "arena_append": True, "arena_address": 0x09000000, "arena_capacity": 4096,
        "arena_entry": None,
        "scope": "Two bounded battle-internal leaves; no direct dependency between these leaves is asserted",
        "system_contract": "research/deep-extraction/resume/pokemon-emerald-version/next-extraction/system.json",
        "open_dependencies": ["Original turn scheduler 0803d2e8", "Comparator 0803cf10 and its weather/RNG services",
                              "Original initialization and lifetime of 02024076 side map and 0202407a/0202407e paired lanes"],
    },
    "firered-rev1": {
        "id": "firered-rev1-script-lifecycle-ir/1",
        "original_sha256": "729041b940afe031302d630fdbe57c0c145f3f7b6d9b8eca5e98678d0ca4d059",
        "original_sha1": "dd5945db9b930750cb39d00c84da8571feebf417",
        "targets": [("initialize", "firered.text.wait_initialize", "080054dc"),
                    ("acknowledge", "firered.text.timed_acknowledgement", "0800561c")],
        "arena_append": True, "arena_address": 0x09000000, "arena_capacity": 4096,
        "arena_entry": None,
        "scope": "Internal script lifecycle dependency pair sharing original caller-owned text context; not a user-facing gameplay building block",
        "system_contract": "research/deep-extraction/resume/pokemon-firered-version/next-extraction/system.json",
        "open_dependencies": ["Original dispatcher 080057a4 and acknowledgement parent 08005648",
                              "Canonical r0 text context: byte+15 packed indicator and byte+16 counter",
                              "Original selector 0203adfa and policy 03003e50 producers",
                              "Window backing, input, BIOS memory effects and sound lifecycle remain retained host services"],
    },
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=PROFILES, required=True)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vectors", type=int, default=4096)
    parser.add_argument("--qualification-root", type=Path,
                        help="Emerald item source library; defaults to retained items001")
    args = parser.parse_args()
    profile = copy.deepcopy(PROFILES[args.game])
    if args.game == "emerald-items":
        root = Path(__file__).resolve().parents[2]
        evidence_names = ["source-layout-evidence.json", "clamp-return-abi.json", "clamp/dependency-adapter.json"]
        evidence_root = ((root / args.qualification_root).resolve().relative_to(root)
                         if args.qualification_root else Path("local/ir/pokemon-next-20261016/items001"))
        profile["package_roots"] = {package: str(evidence_root / label) for label, package, _ in profile["targets"]}
        profile["source_context"] = {"qualified_source_group": [
            {"path": str(evidence_root / name), "sha256": hashlib.sha256((root / evidence_root / name).read_bytes()).hexdigest()}
            for name in evidence_names],
            "semantic_scope": "Immutable metadata reader dependency closure; item effect execution and battle scheduling remain retained"}
    elif args.qualification_root:
        parser.error("--qualification-root applies only to --game emerald-items")
    report = run(profile, args.original, args.baseline, args.output, args.vectors)
    print(json.dumps({"outcome": report["outcome"], "report": str(args.output / "provider-report.json"),
                      "rebuilt_sha256": report["rebuilt_sha256"], "raw_different_bytes": report["raw_changed_bytes"],
                      "generated_behavior_bytes": report["generated_behavior_function_bytes"],
                      "total_seconds": report["timing"]["total_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
