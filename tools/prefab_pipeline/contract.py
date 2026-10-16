"""Integrity and promotion boundaries for the reusable prefab pipeline.

Records are JSON-compatible dictionaries, deliberately independent of extraction
and compiler implementations. A valid partial capsule is not a closed capsule.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

SCHEMA_VERSION = 1
LEVELS = ("L0", "L1", "L2")
BACKENDS = ("source-engine-import", "portable-ir", "native-rom-patch")
_SHA = re.compile(r"^[0-9a-f]{64}$")


def canonical_hash(value: Any) -> str:
    """Hash canonical JSON; reject NaN and other non-JSON values."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def file_ref(path: str | Path, root: str | Path | None = None) -> dict:
    path = Path(path)
    actual = Path(root) / path if root is not None and not path.is_absolute() else path
    return {"path": str(path), "sha256": hashlib.sha256(actual.read_bytes()).hexdigest()}


def verify_file_ref(ref: Any, root: str | Path | None = None) -> bool:
    if not isinstance(ref, Mapping) or not isinstance(ref.get("path"), str):
        return False
    if not isinstance(ref.get("sha256"), str) or not _SHA.fullmatch(ref["sha256"]):
        return False
    try:
        return file_ref(ref["path"], root)["sha256"] == ref["sha256"]
    except (OSError, ValueError):
        return False


def _refs(value: Any):
    if isinstance(value, Mapping):
        # source.path may identify an editable tree while source.sha256 pins its
        # origin ROM. Actual source objects are pinned separately in source.refs.
        if "path" in value and "sha256" in value and not any(
                key in value for key in ("engine", "refs", "abi", "commit")):
            yield value
        else:
            for child in value.values():
                yield from _refs(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _refs(child)


def validate_capsule(capsule: Any, root: str | Path | None = None,
                     verify_files: bool = True) -> list[str]:
    """Validate records and their pins, allowing truthful incomplete candidates."""
    if not isinstance(capsule, Mapping):
        return ["capsule must be an object"]
    errors = []
    if capsule.get("schema_version", SCHEMA_VERSION) != SCHEMA_VERSION:
        errors.append("unsupported capsule schema_version")
    if not isinstance(capsule.get("prefab_id"), str) or not capsule["prefab_id"]:
        errors.append("prefab_id is required")
    if capsule.get("level") not in LEVELS:
        errors.append("level must be L0, L1 or L2")
    if capsule.get("backend") not in BACKENDS:
        errors.append("unsupported backend (source-engine-import, portable-ir, native-rom-patch)")
    if not isinstance(capsule.get("source"), Mapping):
        errors.append("source must be an object")
    if not isinstance(capsule.get("closure"), Mapping):
        errors.append("closure must be an object")
    for field in ("state", "provides", "requires", "dependencies", "assets", "resources",
                  "evidence", "gaps", "obligations"):
        if field in capsule and not isinstance(capsule[field], list):
            errors.append(f"{field} must be a list")
    source = capsule.get("source", {})
    if isinstance(source, Mapping) and "refs" in source and not isinstance(source["refs"], list):
        errors.append("source.refs must be a list")
    for ref in _refs(capsule):
        if not isinstance(ref.get("sha256"), str) or not _SHA.fullmatch(ref["sha256"]):
            errors.append(f"invalid SHA-256: {ref.get('path')}")
        elif verify_files and not verify_file_ref(ref, root):
            errors.append(f"missing or stale file: {ref.get('path')}")
    return errors


def closure_errors(capsule: Mapping, root: str | Path | None = None,
                   verify_files: bool = True, evidence_verifier=None) -> list[str]:
    errors = validate_capsule(capsule, root, verify_files)
    if errors:
        return errors
    if capsule["level"] != "L2":
        errors.append("L0/L1 evidence cannot establish L2 closure")
    closure = capsule["closure"]
    if closure.get("status") != "closed" or closure.get("missing"):
        errors.append("closure is incomplete")
    if any(not isinstance(gap, Mapping) or gap.get("status") not in ("resolved", "closed")
           for gap in capsule.get("gaps", [])):
        errors.append("unresolved gaps prevent closure")
    for dep in capsule.get("dependencies", []):
        if not isinstance(dep, Mapping) or dep.get("resolved") is not True:
            errors.append("unresolved dependency prevents closure")
    obligations = capsule.get("obligations", [])
    if not obligations or any(not isinstance(x, str) or not x for x in obligations):
        errors.append("scope must declare nonempty evidence obligations")
    evidence = capsule.get("evidence", [])
    # Pinning arbitrary JSON does not establish native execution. The backend's
    # verifier understands its receipt format and must validate actual evidence.
    proved = set()
    if evidence_verifier is None:
        errors.append("backend evidence verifier is required for closure")
    else:
        for item in evidence:
            if (isinstance(item, Mapping) and item.get("status") == "passed"
                    and verify_file_ref(item.get("ref"), root)):
                try:
                    if evidence_verifier(item, capsule, root) is True:
                        proved.add(item.get("kind"))
                except Exception:
                    errors.append(f"backend evidence verifier failed: {item.get('kind')}")
    for obligation in obligations:
        if obligation not in proved:
            errors.append(f"missing pinned passing evidence: {obligation}")
    lifecycle = capsule.get("lifecycle", {})
    for boundary in ("entry", "exit"):
        declaration = lifecycle.get(boundary) if isinstance(lifecycle, Mapping) else None
        if not declaration or declaration == "unsupported" or isinstance(declaration, bool):
            errors.append(f"lifecycle {boundary} is unresolved")
        elif isinstance(declaration, Mapping) and declaration.get("status") == "not-applicable":
            if not declaration.get("reason") or not verify_file_ref(declaration.get("evidence"), root):
                errors.append(f"lifecycle {boundary} exemption requires reason and pinned evidence")
            if not any(kind in proved for kind in (boundary, f"lifecycle-{boundary}")):
                errors.append(f"lifecycle {boundary} exemption requires backend verification")
        elif not any(kind in proved for kind in (boundary, f"lifecycle-{boundary}")):
            errors.append(f"lifecycle {boundary} requires pinned execution evidence")
    return errors


def capsule_closed(capsule: Mapping, root: str | Path | None = None,
                   verify_files: bool = True, evidence_verifier=None) -> bool:
    return not closure_errors(capsule, root, verify_files, evidence_verifier)


def cache_key(stage: str, mechanisms: Mapping, config: Mapping,
              inputs: Sequence[Mapping]) -> str:
    """Mechanisms include exact implementation/tool versions, never 'latest'."""
    if not stage or not mechanisms or not inputs:
        raise ValueError("stage, pinned mechanisms and inputs are required")
    if any(value in ("latest", "HEAD", "main", "master") for value in mechanisms.values()
           if isinstance(value, str)):
        raise ValueError("mechanisms must use exact versions, not moving names")
    return canonical_hash({"schema_version": SCHEMA_VERSION, "stage": stage,
                           "mechanisms": mechanisms, "config": config,
                           "inputs": sorted(inputs, key=lambda x: (x["path"], x["sha256"]))})


def make_cache_record(key: str, inputs: Sequence[Mapping], outputs: Sequence[Mapping],
                      *, outcome: str, timing: Mapping | None = None) -> dict:
    return {"schema_version": SCHEMA_VERSION, "key": key, "inputs": list(inputs),
            "outputs": list(outputs), "outcome": outcome, "timing": dict(timing or {})}


def verify_cache_record(record: Mapping, expected_key: str,
                        root: str | Path | None = None) -> bool:
    """Only successful records with intact inputs AND outputs are reusable."""
    return (isinstance(record, Mapping) and record.get("key") == expected_key
            and record.get("outcome") == "success"
            and isinstance(record.get("inputs"), list) and bool(record["inputs"])
            and isinstance(record.get("outputs"), list) and bool(record["outputs"])
            and all(verify_file_ref(r, root) for r in record["inputs"] + record["outputs"]))


def build_repair_request(request_id: str, inputs: Sequence[Mapping],
                         expected_outputs: Sequence[str], limits: Mapping,
                         *, context: Mapping | None = None,
                         root: str | Path | None = None) -> dict:
    request = {"schema_version": SCHEMA_VERSION, "request_id": request_id,
               "operation": "semantic-repair", "inputs": list(inputs),
               "expected_outputs": list(expected_outputs), "limits": dict(limits),
               "context": dict(context or {}), "can_promote": False}
    request["input_set_sha256"] = canonical_hash(request["inputs"])
    errors = validate_repair_request(request, root)
    if errors:
        raise ValueError("; ".join(errors))
    return request


def validate_repair_request(request: Mapping, root: str | Path | None = None,
                            verify_files: bool = True) -> list[str]:
    errors = []
    if not request.get("request_id") or request.get("operation") != "semantic-repair":
        errors.append("repair request identity and operation are required")
    inputs = request.get("inputs", [])
    if not inputs or request.get("input_set_sha256") != canonical_hash(inputs):
        errors.append("exact pinned input set is required")
    if verify_files and any(not verify_file_ref(ref, root) for ref in inputs):
        errors.append("repair input is missing or stale")
    outputs = request.get("expected_outputs", [])
    if not outputs or any(not isinstance(p, str) or not p or Path(p).is_absolute()
                          or ".." in Path(p).parts for p in outputs):
        errors.append("expected output paths must be nonempty relative paths")
    limits = request.get("limits", {})
    for key in ("max_attempts", "max_time_s", "max_cost_usd"):
        value = limits.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            errors.append(f"positive finite {key} is required")
    if not isinstance(limits.get("max_attempts"), int):
        errors.append("max_attempts must be an integer")
    if request.get("can_promote") is not False:
        errors.append("repair workers cannot promote their outputs")
    return errors


def validate_composition_request(request: Mapping) -> list[str]:
    errors = []
    if request.get("target") != "gba":
        errors.append("only target gba is supported")
    if not isinstance(request.get("prefabs"), list) or not request["prefabs"]:
        errors.append("prefabs must be nonempty")
    limits = request.get("limits", {})
    for key in ("jobs", "timeout_s"):
        value = limits.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            errors.append(f"positive finite {key} required")
    return errors
