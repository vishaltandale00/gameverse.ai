"""Reproduce MZM arm source frontier; static evidence only, no qualification."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
EXPORT = ROOT / "local/roundtrip/mzm-arm-parent-20261016/l0"
ROM = ROOT / "local/roms/Metroid - Zero Mission (USA).gba"
PARENT = "global:0:50333531"


def run(output):
    output.mkdir(parents=True, exist_ok=False)
    sys.path.insert(0, str(ROOT / "tools/behavior_ir"))
    from lift import Lifter
    from lower import lower
    raw = ROM.read_bytes()
    if hashlib.sha256(raw).hexdigest() != "fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37":
        raise ValueError("MZM original ROM identity mismatch")
    dependencies, results = {}, []
    for label, entry in (("sync", "08014834"), ("seated", "080148a8"), ("admission", "08014794")):
        directory = output / label
        directory.mkdir()
        source = EXPORT / (entry + ".json")
        kwargs = {} if label == "sync" else {"state_domains": {PARENT: {"unsigned_min": 0, "unsigned_max": 23}}}
        row = {"label": label, "entry": entry, "l0_path": str(source.relative_to(ROOT)),
               "l0_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "lifter_kwargs": kwargs}
        started = time.perf_counter()
        try:
            behavior, adapter = Lifter(json.loads(source.read_text()), raw, dependencies, **kwargs).build()
            for name, data in (("l1.json", behavior), ("validation-adapter.json", adapter)):
                (directory / name).write_text(json.dumps(data, indent=2) + "\n")
            (directory / "generated.c").write_text(lower(behavior))
            dependencies[entry] = (behavior, adapter)
            row.update(outcome="static-pass", collections=adapter.get("collections", []), fields=len(adapter["fields"]))
        except Exception as error:
            row.update(outcome="blocked", error=str(error), error_type=type(error).__name__)
        row["seconds"] = time.perf_counter() - started
        results.append(row)
    report = {"schema": "gameverse.mzm-arm-static-frontier/1", "results": results,
              "parent_domain_scope": "Invocation precondition: valid live original parent slot0..23; not a proof of arbitrary scratch or lifetime validity",
              "native_qualified_roots": 0, "installed_roots": 0, "ir_regenerated_rom_bytes": 0,
              "known_backend_gap": "Seated parent pose uses24 byte cells stride56; current contiguous1289-byte binding would exceed fixed2048 instruction cap. This is a predicted limit, not an executed native failure."}
    (output / "receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(run(parser.parse_args().output), indent=2))
