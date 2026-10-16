#!/usr/bin/env python3
"""Resolve ontology components to inspectable local source and declared bridges.

This is a source lookup table, not a universal linker: only reviewed recipes are
buildable. Missing sources/symbols remain unresolved instead of being invented.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import yaml

ROOT = Path(__file__).resolve().parents[2]
REPOS = {name: name for name in ("mzm", "mf", "pokeemerald", "pokefirered", "pokeruby",
         "sa2", "warioland4", "pmd-red", "cvaos", "ffta-decomp", "khcom", "mksc", "mlss", "tmc")}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def evidence_refs(value):
    if isinstance(value, dict):
        if value.get("kind") == "decomp_source" and isinstance(value.get("ref"), str):
            yield value["ref"]
        for child in value.values():
            yield from evidence_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from evidence_refs(child)


def definition_match(content, name):
    """Conservative function declaration followed by its opening brace."""
    return re.search(r"^[ \t]*(?!if\b|while\b|for\b|switch\b|return\b)(?:[A-Za-z_]\w*[ \t]+|[A-Za-z_]\w*[ \t]*\*+[ \t]*|\*+[ \t]*)+" + re.escape(name) + r"\([^;{}]*\)\s*\{", content, re.M)


def resolve(ref):
    result = {"ref": ref, "status": "unresolved"}
    match = re.match(r"([\w-]+):([^: ]+)(?::([^\n]+))?", ref)
    if not match or match[1] not in REPOS:
        result["reason"] = "No configured source checkout for reference"
        return result
    repo = ROOT / "local/decomps" / REPOS[match[1]]
    path = (repo / match[2]).resolve()
    if not path.is_relative_to(repo.resolve()) or not path.is_file():
        result["reason"] = "Source file unavailable"
        return result
    data = path.read_bytes()
    result.update(path=str(path.relative_to(ROOT)), file_sha256=digest(data))
    result["source_commit"] = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    result["tracked_source_dirty"] = bool(subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain", "--", match[2]], text=True).strip())
    content = data.decode("utf-8", errors="replace")
    tail = match[3] or ""
    symbol = re.match(r"([A-Za-z_]\w*)", tail)
    if not tail:
        result.update(status="source_file", line=1, reason="File evidence only; no symbol claimed")
        return result
    if symbol:
        name = symbol[1]
        hits = list(re.finditer(r"\b" + re.escape(name) + r"\b", content))
        result["symbol"] = name
        if not hits:
            result["reason"] = "Referenced symbol absent at current source revision"
            return result
        # Prefer a definition over a declaration or call. Keep an exact span
        # only where the balanced extractor can establish it.
        # A type/declaration prefix cannot contain an opening parenthesis.
        # In particular, an earlier `if (Target(...)) {}` is a call, never the
        # definition of Target. Ambiguous syntax stays an occurrence.
        definition = definition_match(content, name)
        if definition:
            try:
                from tools.gba_mashup.extract_emerald import block
            except ModuleNotFoundError:
                from extract_emerald import block
            span, line = block(content, r"^" + re.escape(content[definition.start():content.index("{", definition.start())].rstrip()))
            result.update(status="source_definition", line=line, span_sha256=digest(span.encode()), source_text=span)
        else:
            result.update(status="source_occurrence", line=content.count("\n", 0, hits[0].start())+1,
                          reason="Symbol found; declaration/definition boundary not established")
    else:
        result.update(status="source_file", line=1, reason="Unparsed symbol suffix; file is inspectable")
    return result


def lookup(game, component, include_source=False):
    path = ROOT / "ontology/games" / (game + ".yaml")
    if not path.is_file() or not path.resolve().is_relative_to((ROOT / "ontology/games").resolve()):
        raise ValueError("Unknown ontology game")
    document = yaml.safe_load(path.read_text())
    item = next((x for x in document["components"] if x["id"] == component), None)
    if item is None:
        raise ValueError("Unknown component: " + game + ":" + component)
    sources = [resolve(ref) for ref in dict.fromkeys(evidence_refs(item))]
    if not include_source:
        for source in sources:
            source.pop("source_text", None)
    return {"schema_version": 1, "key": game + ":" + component,
            "ontology_path": str(path.relative_to(ROOT)), "ontology_sha256": digest(path.read_bytes()),
            "label": item.get("label"), "facet": item.get("facet"), "summary": item.get("summary"),
            "reads": item.get("reads", []), "writes": item.get("writes", []),
            "invariants": item.get("invariants", []), "relations": item.get("relations", []),
            "sources": sources,
            "assembly_status": "Lookup evidence only; requires a reviewed native integration recipe"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game")
    parser.add_argument("--component")
    parser.add_argument("--query", help="Literal words searched across labels, summaries and IDs")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--include-source", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.game and args.component:
        result = lookup(args.game, args.component, args.include_source)
    elif args.query:
        words = args.query.casefold().split()
        matches = []
        for path in sorted((ROOT / "ontology/games").glob("*.yaml")):
            document = yaml.safe_load(path.read_text())
            for item in document.get("components", []):
                text = " ".join(str(item.get(k, "")) for k in ("id", "label", "summary")).casefold()
                score = sum(word in text for word in words)
                if score:
                    matches.append({"key": document["id"]+":"+item["id"], "label": item.get("label"), "score": score,
                                    "source_backed": bool(list(evidence_refs(item)))})
        result = {"matches": sorted(matches, key=lambda row: (-row["score"], row["key"]))[:max(1,min(100,args.limit))],
                  "method": "literal ontology lookup; embedding similarity is separate evidence"}
    else:
        parser.error("Provide --game/--component or --query")
    output = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
