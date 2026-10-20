"""Extract addressed components, preserving unknown regions as opaque artifacts."""
from __future__ import annotations
import json
from pathlib import Path
import re
from .reassemble import MAX_IMAGE_BYTES, SCHEMA, integer, sha


def extract(source, output, game_id, profile=None, chunk_bytes=1024 * 1024):
    source, output = Path(source).resolve(), Path(output)
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_IMAGE_BYTES:
        raise ValueError("Expected bounded, existing original cartridge")
    if type(chunk_bytes) is not int or not 1 <= chunk_bytes <= MAX_IMAGE_BYTES:
        raise ValueError("Invalid opaque component chunk bound")
    raw = source.read_bytes()
    raw_hash = sha(raw)
    profile_path = Path(profile).resolve() if profile else None
    config = json.loads(profile_path.read_text()) if profile_path else {}
    if config and config.get("original_sha256") != raw_hash:
        raise ValueError("Extraction profile original identity mismatch")
    selected = sorted(config.get("components", []), key=lambda r: integer(r["offset"], "Offset"))
    spans, cursor = [], 0
    for selected_row in selected:
        row = dict(selected_row)
        offset, size = integer(row["offset"], "Offset"), integer(row["size"], "Size")
        if offset < cursor or size <= 0 or offset + size > len(raw):
            raise ValueError("Profile range overlaps or exceeds original")
        while cursor < offset:
            count = min(chunk_bytes, offset - cursor)
            spans.append({"id": f"opaque-{cursor:08x}", "offset": cursor, "size": count})
            cursor += count
        spans.append(row)
        cursor = offset + size
    while cursor < len(raw):
        count = min(chunk_bytes, len(raw) - cursor)
        spans.append({"id": f"opaque-{cursor:08x}", "offset": cursor, "size": count})
        cursor += count
    if len(spans) > 4096:
        raise ValueError("Extraction exceeds component bound")
    prepared, identities, evidence_files, evidence_cache = [], set(), {}, {}
    for row in spans:
        name = row["id"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", name) or name in identities:
            raise ValueError("Unsafe or duplicate component id")
        identities.add(name)
        data = raw[row["offset"]:row["offset"] + row["size"]]
        provider = row.get("provider", {"kind": "opaque_bytes"})
        kind = provider.get("kind")
        if kind != "opaque_bytes":
            if kind not in ("ir_generated", "source_generated", "data_generated") or not profile_path:
                raise ValueError("Unsupported generated provider")
            pin = provider.get("generated_artifact", {})
            generated = (profile_path.parent / pin["path"]).resolve()
            replacement = generated.read_bytes()
            if sha(replacement) != pin["sha256"] or replacement != data:
                raise ValueError("Generated component must exactly reproduce original range")
            if not provider.get("recipe") or not row.get("evidence"):
                raise ValueError("Generated components require recipe and evidence")
            data = replacement
        digest = sha(data)
        stratum = row.get("stratum", "opaque-preserved" if kind == "opaque_bytes" else {"ir_generated": "ir-regenerated", "source_generated": "source-regenerated", "data_generated": "data-regenerated"}[kind])
        evidence = []
        for item in row.get("evidence", []):
            if isinstance(item, dict) and profile_path:
                path = (profile_path.parent / item["path"]).resolve()
                if path not in evidence_cache:
                    payload = path.read_bytes()
                    evidence_cache[path] = (payload, sha(payload))
                payload, payload_hash = evidence_cache[path]
                if payload_hash != item["sha256"]:
                    raise ValueError("Stale generated provider evidence")
                ref = "evidence/" + payload_hash + path.suffix
                evidence_files[ref] = payload
                evidence.append({"path": ref, "sha256": payload_hash})
            else:
                evidence.append(item)
        entry = {"id": name, "version": row.get("version", "sha256:" + digest),
                 "offset": row["offset"], "size": len(data), "sha256": digest,
                 "artifact": {"path": "components/" + name + ".bin", "sha256": digest},
                 "stratum": stratum, "provider": provider,
                 "dependencies": row.get("dependencies", []), "relocations": row.get("relocations", []),
                 "closure": row.get("closure", {"status": "unknown", "reason": "Opaque address partition; semantic boundaries and dependencies unresolved"}),
                 "contract": row.get("contract", {}), "evidence": evidence,
                 "provenance": {"source_sha256": raw_hash, "offset": row["offset"], "size": len(data)}}
        prepared.append((entry, data))
    output.mkdir(parents=True, exist_ok=False)
    (output / "components").mkdir()
    if evidence_files:
        (output / "evidence").mkdir()
        for ref, payload in evidence_files.items():
            (output / ref).write_bytes(payload)
    for entry, data in prepared:
        with (output / entry["artifact"]["path"]).open("xb") as stream:
            stream.write(data)
    manifest = {"schema": SCHEMA, "game_id": game_id, "address_base": integer(config.get("address_base", 0x08000000), "Address base"),
                "original": {"path": str(source), "sha256": raw_hash, "size": len(raw)},
                "constraints": {"preserve_layout": True}, "components": [r for r, _ in prepared],
                "provenance": {"profile": str(profile_path) if profile_path else None,
                               "profile_sha256": sha(profile_path.read_bytes()) if profile_path else None},
                "prefabs": config.get("prefabs", []),
                "claims": {"container_exact_reconstruction": "pending-comparison", "whole_game_semantic_closure": False}}
    with (output / "manifest.json").open("x") as stream:
        json.dump(manifest, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return manifest
