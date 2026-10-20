"""Retain the compiler modules actually loaded by a bounded static IR recipe."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import platform
import sys
import time

from .reassemble import sha

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT/"tools/behavior_ir"


def capture_runtime_dependencies(output):
    """Observe imports, deduplicate resolved sources and preserve their contents.

    Call after the real lift/lower/proof stages, so lazy compiler imports are
    included. Standard library modules are represented by interpreter context.
    """
    output = Path(output)
    sources = {}
    for name,module in tuple(sys.modules.items()):
        filename = getattr(module,"__file__",None)
        if not filename:
            continue
        path = Path(filename).resolve()
        if path.suffix != ".py" or not (path.is_relative_to(COMPILER) or path.is_relative_to(ROOT/"tools/roundtrip")):
            continue
        sources.setdefault(path,[]).append(name)
    records = []
    for path,names in sorted(sources.items()):
        relative = path.relative_to(ROOT)
        payload = path.read_bytes()
        snapshot = output/"sources"/relative
        snapshot.parent.mkdir(parents=True,exist_ok=True)
        snapshot.write_bytes(payload)
        records.append({"source":str(relative),"module_names":sorted(names),
                        "snapshot":str(snapshot.relative_to(output)),"sha256":sha(payload)})
    return {"schema":"gameverse.compiler-runtime-dependencies/1","modules":records,
            "python":sys.version,"machine":platform.platform(),
            "scope":"Observed compiler/roundtrip Python modules; standard library and native toolchains use version context"}


def supplement(report_path,original,output):
    """Replay static derivation only; keep the original run report immutable."""
    started = time.perf_counter()
    report_path,original,output = map(Path,(report_path,original,output))
    report = json.loads(report_path.read_text())
    raw = original.read_bytes()
    if sha(raw) != report["original_sha256"]:
        raise ValueError("Wrong original ROM")
    output.mkdir(parents=True,exist_ok=False)
    sys.path.insert(0,str(COMPILER))
    from lift import Lifter
    from lower import lower
    dependencies = {}
    inputs = []
    for label,_,entry in report["profile"]["targets"]:
        directory = report_path.parent/label
        l0 = json.loads((directory/"l0.json").read_text())
        if report["profile"].get("retained_ir"):
            x = json.loads((directory/"l1.json").read_text())
            adapter = json.loads((directory/"validation-adapter.json").read_text())
        else:
            x,adapter = Lifter(l0,raw,dependencies).build()
        dependencies[entry] = (x,adapter)
        expected = json.loads((directory/"l1.json").read_text())
        if x != expected or lower(x) != (directory/"generated.c").read_text():
            raise ValueError("Current static recipe does not reproduce retained IR/C")
        inputs.append({"label":label,"l0_sha256":sha((directory/"l0.json").read_bytes()),
                       "l1_sha256":sha((directory/"l1.json").read_bytes()),
                       "generated_c_sha256":sha((directory/"generated.c").read_bytes())})
    inventory = capture_runtime_dependencies(output)
    inventory.update(producer_report_sha256=sha(report_path.read_bytes()),
                     rebuilt_sha256=report["rebuilt_sha256"],original_sha256=sha(raw),inputs=inputs,
                     derivation="Retrospective static recipe replay with exact L1/C equality; not a claim that this inventory was captured during the original native run",
                     native_rerun=False,timing={"static_replay_and_snapshot_seconds":time.perf_counter()-started,"queue_seconds":None},outcome="pass")
    (output/"receipt.json").write_text(json.dumps(inventory,indent=2,sort_keys=True)+"\n")
    return inventory


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report",type=Path,required=True)
    parser.add_argument("--original",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    result=supplement(args.report,args.original,args.output)
    print(json.dumps({"outcome":result["outcome"],"modules":len(result["modules"]),"timing":result["timing"]}))
