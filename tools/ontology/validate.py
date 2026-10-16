# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml>=6", "jsonschema>=4.23"]
# ///
"""Validate ontology/games/*.yaml against the game schema and internal references.

Usage: uv run tools/ontology/validate.py [ontology/games/<id>.yaml ...]
"""
import json
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "ontology/schema/game.schema.json").read_text())


def known_concepts() -> set[str]:
    """Concept IDs from the vocabulary files plus every game's proposed_concepts."""
    ids = set()
    for p in (ROOT / "ontology/concepts").glob("*.yaml"):
        ids |= {c["id"] for c in yaml.safe_load(p.read_text()) or []}
    for p in (ROOT / "ontology/games").glob("*.yaml"):
        try:  # a half-written file from a parallel extractor must not break validation of the others
            ids |= {c["id"] for c in (yaml.safe_load(p.read_text()) or {}).get("proposed_concepts", [])}
        except yaml.YAMLError:
            continue
    return ids


def check(path: Path, concepts: set[str]) -> list[str]:
    try:
        doc = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        return [f"YAML parse error: {e}"]
    errors = [f"{'/'.join(map(str, e.path))}: {e.message}" for e in Draft202012Validator(SCHEMA).iter_errors(doc)]
    if errors:
        return errors
    for c in doc["components"]:
        errors += [f"{c['id']}: unknown concept {i['concept']}" for i in c["instantiates"] if i["concept"] not in concepts]
    for pc in doc.get("proposed_concepts", []):
        errors += [f"proposed {pc['id']}: unknown is_a {p}" for p in pc.get("is_a", []) if p not in concepts]
    if doc["id"] != path.stem:
        errors.append(f"id {doc['id']!r} does not match filename")
    ids = [c["id"] for c in doc["components"]]
    errors += [f"duplicate component id {i}" for i in {i for i in ids if ids.count(i) > 1}]
    for c in doc["components"]:
        for r in c.get("relations", []):
            t = r["target"]
            if "/" not in t and "." not in t and t not in ids:
                errors.append(f"{c['id']}: relation target {t!r} not found")
    return errors


if __name__ == "__main__":
    paths = [Path(p) for p in sys.argv[1:]] or sorted((ROOT / "ontology/games").glob("*.yaml"))
    concepts = known_concepts()
    failed = 0
    for p in paths:
        errs = check(p, concepts)
        failed += bool(errs)
        print(f"{'FAIL' if errs else 'ok  '} {p.name}" + "".join(f"\n  - {e}" for e in errs[:20]))
    sys.exit(1 if failed else 0)
