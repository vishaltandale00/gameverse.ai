# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml>=6"]
# ///
"""Offline evidence inventory; complements validate.py, not a factual evaluator.

Usage: python3 tools/ontology/audit_ontologies.py [game.yaml ...] [--json report.json]

Checks citation files and component references, and reports operational coverage.
A resolvable source path does NOT establish that its associated claim is true.
No model calls, ontology edits, or source-code copies are made by this tool.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import time
import uuid

import yaml

ROOT = Path(__file__).resolve().parents[2]
OPERATIONAL = {"mechanics", "movement_physics", "ai", "progression"}


def evidence_records(value, location=""):
    """Yield evidence with its claim location, including params and tables."""
    if isinstance(value, dict):
        if {"kind", "ref", "confidence"} <= value.keys():
            yield location, value
        for key, child in value.items():
            yield from evidence_records(child, f"{location}/{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from evidence_records(child, f"{location}/{index}")


def source_path_status(ref, decomp_root):
    """Resolve repo:path citations. Wildcards are reported separately from files."""
    match = re.match(r"([^:\s]+):([^:\s,;)]+)", ref)
    if not match:
        return "unparsed"
    repo, relative = match.groups()
    base = decomp_root.resolve()
    path = (base / repo / relative).resolve()
    if not path.is_relative_to(base):
        return "outside_decomp_root"
    if any(char in relative for char in "*?["):
        try:
            return "glob_matches" if any((base / repo).glob(relative)) else "missing_glob"
        except (ValueError, NotImplementedError):
            return "unparsed"
    if path.is_dir():
        return "directory_only"
    return "file_exists" if path.is_file() else "missing_file"


def audit_document(doc, corpus, decomp_root):
    components = doc.get("components", [])
    operational = [c for c in components if c.get("facet") in OPERATIONAL]
    findings = []

    def finding(code, location, detail, severity="warning"):
        findings.append(dict(code=code, location=location, detail=detail, severity=severity))

    evidence_counts = Counter()
    source_counts = Counter()
    for location, evidence in evidence_records(doc):
        kind = evidence["kind"]
        evidence_counts[kind] += 1
        if kind == "decomp_source":
            status = source_path_status(evidence["ref"], decomp_root)
            source_counts[status] += 1
            if status not in {"file_exists", "glob_matches"}:
                finding("source_" + status, location, evidence["ref"])
        if kind == "derived" and not evidence.get("inputs"):
            finding("derived_inputs_missing", location, evidence["ref"])
        if kind == "llm_knowledge" and evidence["confidence"] > 0.6:
            finding("recall_confidence_above_brief_limit", location, evidence["ref"])

    coverage = {field: sum(bool(c.get(field)) for c in operational)
                for field in ("reads", "writes", "params", "invariants", "relations")}
    params = []
    for component in components:
        cid = component.get("id", "?")
        for name, param in component.get("params", {}).items():
            params.append(param)
            if not param.get("evidence"):
                finding("param_evidence_missing", f"{cid}/params/{name}", "Parameter has no claim-level evidence.")
        for relation in component.get("relations", []):
            target = relation["target"]
            if "/" in target:
                game_id, component_id = target.split("/", 1)
                if game_id not in corpus:
                    finding("relation_game_unavailable", cid, target)
                elif component_id not in {c["id"] for c in corpus[game_id].get("components", [])}:
                    finding("relation_component_missing", cid, target)
            elif "." not in target and target not in {c["id"] for c in components}:
                finding("relation_component_missing", cid, target)

    return {
        "id": doc.get("id"),
        "components": len(components),
        "facets": dict(sorted(Counter(c.get("facet") for c in components).items())),
        "operational_components": len(operational),
        "operational_field_coverage": coverage,
        "evidence_records": dict(sorted(evidence_counts.items())),
        "decomp_citation_path_status": dict(sorted(source_counts.items())),
        "params": len(params),
        "params_with_evidence": sum(bool(p.get("evidence")) for p in params),
        "params_with_explicit_native_value": sum("native_value" in p for p in params),
        "extraction_runs": [s["ref"] for s in doc.get("game", {}).get("sources", [])
                            if s.get("kind") == "extraction_run"],
        "findings": findings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", type=Path, nargs="*")
    parser.add_argument("--json", type=Path, help="Save JSON report (otherwise stdout).")
    parser.add_argument("--decomp-root", type=Path, default=ROOT / "local/decomps")
    args = parser.parse_args(argv)
    started = time.perf_counter()
    paths = args.paths or sorted((ROOT / "ontology/games").glob("*.yaml"))
    # Include sibling games for cross-game relations even when auditing one game.
    corpus = {}
    for path in sorted((ROOT / "ontology/games").glob("*.yaml")):
        try:
            doc = yaml.safe_load(path.read_text())
            corpus[doc["id"]] = doc
        except (yaml.YAMLError, TypeError, KeyError):
            continue  # a parallel extractor may be writing a different game
    results = []
    for path in paths:
        contents = path.read_bytes()
        try:
            doc = yaml.safe_load(contents)
            if not isinstance(doc, dict):
                raise ValueError("Expected a YAML object; run validate.py for schema checks.")
            corpus[doc["id"]] = doc
            result = audit_document(doc, corpus, args.decomp_root)
        except (yaml.YAMLError, KeyError, TypeError, ValueError) as exc:
            result = {"error": str(exc)}
        result.update(path=str(path), sha256=hashlib.sha256(contents).hexdigest())
        results.append(result)
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    report = {
        "audit_version": 1,
        "run_id": uuid.uuid4().hex,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "source_commit": commit,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "duration_seconds": round(time.perf_counter() - started, 6),
        "limitations": ["Path existence is not claim entailment or symbol verification.",
                        "Operational field presence is coverage, not semantic correctness.",
                        "Native values in prose notes are not counted as explicit native_value fields.",
                        "No model quality, provider cost, queue time, or gameplay behavior is measured.",
                        "Input SHA256 records uncommitted data independently of source_commit."],
        "games": results,
    }
    output = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.json:
        args.json.write_text(output)
    else:
        print(output, end="")
    return int(any("error" in result for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
