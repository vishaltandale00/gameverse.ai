"""Byte-first verification for pinned ROM reconstruction artifacts.

Run directly with ``python -m tools.prefab_pipeline.reconstruction_compare --help``.
No header, filler, opcode, or string heuristics establish equivalence. Reports
retain raw results even when metadata validation or a declared policy fails.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

SCHEMA = "gameverse.rom-roundtrip/1"
STRATA = {"opaque-preserved", "raw-captured", "object-captured", "source-regenerated", "ir-regenerated",
          "native-relocated", "data-regenerated"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def byte_diff(original: bytes, rebuilt: bytes, *, max_ranges: int = 128) -> dict:
    """Count every differing/missing byte, retaining only bounded range samples."""
    if type(max_ranges) is not int or max_ranges < 1:
        raise ValueError("max_ranges must be a positive integer")
    total = max(len(original), len(rebuilt))
    common = min(len(original), len(rebuilt))
    different = ranges_count = 0
    ranges, first, start = [], None, None
    # Equal chunks bypass Python byte iteration for ordinary large ROMs.
    for block in range(0, common, 65536):
        end = min(block + 65536, common)
        if original[block:end] == rebuilt[block:end]:
            if start is not None:
                ranges_count += 1
                if len(ranges) < max_ranges:
                    ranges.append({"offset": start, "size": block - start})
                start = None
            continue
        for offset in range(block, end):
            if original[offset] != rebuilt[offset]:
                different += 1
                if first is None:
                    first = {"offset": offset, "original": original[offset], "rebuilt": rebuilt[offset]}
                if start is None:
                    start = offset
            elif start is not None:
                ranges_count += 1
                if len(ranges) < max_ranges:
                    ranges.append({"offset": start, "size": offset - start})
                start = None
    if common < total:
        different += total - common
        if first is None:
            first = {"offset": common, "original": original[common] if common < len(original) else None,
                     "rebuilt": rebuilt[common] if common < len(rebuilt) else None}
        if start is None:
            start = common
    if start is not None:
        ranges_count += 1
        if len(ranges) < max_ranges:
            ranges.append({"offset": start, "size": total - start})
    return {"exact": different == 0, "original_size": len(original), "rebuilt_size": len(rebuilt),
            "compared_bytes": total, "different_bytes": different, "equal_bytes": total - different,
            "first_difference": first, "difference_range_count": ranges_count,
            "difference_ranges": ranges, "ranges_truncated": ranges_count > len(ranges)}


def _span(row: dict, limit: int) -> bool:
    return (type(row.get("offset")) is int and type(row.get("size")) is int
            and row["offset"] >= 0 and row["size"] > 0 and row["offset"] + row["size"] <= limit)


def _partition(rows: list, limit: int, label: str, errors: list) -> tuple[list, int]:
    valid = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not _span(row, limit):
            errors.append(f"{label}[{index}]: invalid or out-of-bounds offset/size")
        else:
            valid.append(row)
    cursor = covered = 0
    for row in sorted(valid, key=lambda item: item["offset"]):
        start, end = row["offset"], row["offset"] + row["size"]
        if start > cursor:
            errors.append(f"{label}: uncovered range {cursor}:{start}")
        if start < cursor:
            errors.append(f"{label}: overlapping range at {start}")
        covered += max(0, end - max(cursor, start))
        cursor = max(cursor, end)
    if cursor < limit:
        errors.append(f"{label}: uncovered range {cursor}:{limit}")
    return valid, limit - covered


def _gba_header(data: bytes) -> dict:
    if len(data) < 0xC0:
        return {"status": "unavailable", "reason": "image shorter than GBA header"}
    expected = (-sum(data[0xA0:0xBD]) - 0x19) & 255
    return {"status": "checked", "stored_checksum": data[0xBD], "expected_checksum": expected,
            "checksum_valid": data[0xBD] == expected,
            "scope": "checksum only; entry, logo, reserved bytes and entire image remain raw-compared"}


def compare_reconstruction(original: bytes, rebuilt: bytes, manifest: dict,
                           rebuilt_layout: dict | None = None, policy_masks: list | None = None,
                           certificates: list | None = None, *, max_ranges: int = 128,
                           evidence_verifier=None) -> dict:
    """Compare exact bytes and independently report attribution and evidence.

    evidence_verifier(kind, record) is an owner-provided proof verifier. Without
    one, proof records are retained as unverified claims; hashes alone never
    certify behavior. Masks require producer proof admission through this hook.
    """
    began = time.perf_counter()
    original_hash, rebuilt_hash = sha256(original), sha256(rebuilt)
    raw = {"original_sha256": original_hash, "rebuilt_sha256": rebuilt_hash,
           **byte_diff(original, rebuilt, max_ranges=max_ranges)}
    errors = []
    if not isinstance(manifest, dict):
        errors.append("manifest must be an object")
        manifest = {}
    if rebuilt_layout is not None and not isinstance(rebuilt_layout, dict):
        errors.append("rebuilt layout must be an object")
        rebuilt_layout = {}
    if manifest.get("schema") != SCHEMA:
        errors.append("unsupported manifest schema")
    pin = manifest.get("original", {})
    if pin.get("sha256") != original_hash or pin.get("size") != len(original):
        errors.append("original ROM hash/size differs from pinned manifest")
    components = manifest.get("components", [])
    if not isinstance(components, list):
        errors.append("components must be a list")
        components = []
    valid, gaps = _partition(components, len(original), "components", errors)
    by_id = {}
    strata = {key: 0 for key in sorted(STRATA)}
    strata["unknown"] = gaps
    for row in valid:
        identity = row.get("id")
        if not isinstance(identity, str) or not identity or identity in by_id:
            errors.append(f"component identity missing or duplicated: {identity}")
        by_id[identity] = row
        if not isinstance(row.get("version"), str) or not row["version"]:
            errors.append(f"{identity}: immutable component version missing")
        chunk = original[row["offset"]:row["offset"] + row["size"]]
        if row.get("sha256") != sha256(chunk):
            errors.append(f"{identity}: source region hash mismatch")
        for dependency in row.get("dependencies", []):
            dependency_id = dependency.get("target", dependency.get("id")) if isinstance(dependency, dict) else dependency
            matches = [item for item in valid if item.get("id") == dependency_id]
            if not matches:
                errors.append(f"{identity}: unresolved component dependency {dependency_id}")
            elif isinstance(dependency, dict):
                if "version" in dependency and dependency["version"] != matches[0].get("version"):
                    errors.append(f"{identity}: dependency version mismatch for {dependency_id}")
                if dependency.get("sha256") != matches[0].get("sha256"):
                    errors.append(f"{identity}: dependency hash mismatch for {dependency_id}")
        stratum = row.get("stratum", "unknown")
        if stratum not in STRATA:
            errors.append(f"{identity}: unknown reconstruction stratum")
            stratum = "unknown"
        strata[stratum] += row["size"]
        if stratum in {"ir-regenerated", "source-regenerated", "data-regenerated", "native-relocated"} and row.get("provider", {}).get("kind") == "opaque_bytes":
            errors.append(f"{identity}: opaque provider cannot claim regeneration")
    layout = rebuilt_layout or {}
    layout_rows = layout.get("components", [])
    if not isinstance(layout_rows, list):
        errors.append("layout components must be a list")
        layout_rows = []
    if layout.get("schema") != "gameverse.rom-roundtrip-layout/1":
        errors.append("missing or unsupported rebuilt layout schema")
    if layout.get("originalSha256") != original_hash:
        errors.append("layout original ROM hash mismatch")
    artifact = layout.get("artifact", {})
    if artifact.get("sha256") != rebuilt_hash or artifact.get("size") != len(rebuilt):
        errors.append("layout artifact hash/size mismatch")
    if "artifactSha256" in layout and layout["artifactSha256"] != rebuilt_hash:
        errors.append("layout artifactSha256 mismatch")
    mapped, output_gaps = _partition(layout_rows, len(rebuilt), "layout", errors)
    output_by_id = {}
    output_only = []
    for row in mapped:
        identity = row.get("sourceComponent", row.get("id"))
        if identity is None and row.get("role") == "generated-output":
            output_only.append(row)
            if not row.get("id") or not row.get("evidence") or row.get("stratum") not in STRATA:
                errors.append("generated output requires identity, stratum and producer evidence")
            if row.get("sha256") != sha256(rebuilt[row["offset"]:row["offset"] + row["size"]]):
                errors.append(f"{row.get('id')}: generated output region hash mismatch")
            continue
        if identity not in by_id or identity in output_by_id:
            errors.append(f"layout component unknown or duplicated: {identity}")
        output_by_id[identity] = row
        source = by_id.get(identity, {})
        if source.get("version") != row.get("version"):
            errors.append(f"{identity}: layout component version mismatch")
        if manifest.get("constraints", {}).get("preserve_layout") and (row["offset"], row["size"]) != (source.get("offset"), source.get("size")):
            errors.append(f"{identity}: layout moved despite preserve_layout")
        if row.get("sha256") != sha256(rebuilt[row["offset"]:row["offset"] + row["size"]]):
            errors.append(f"{identity}: rebuilt region hash mismatch")
    reports = []
    for source in valid:
        offset, size, identity = source["offset"], source["size"], source.get("id")
        left = original[offset:offset + size]
        mapped_row = output_by_id.get(identity)
        region = {"id": identity, "version": source.get("version"), "offset": offset, "size": size,
                  "stratum": source.get("stratum", "unknown"),
                  "provider": source.get("provider"), "closure": source.get("closure"),
                  "dependencies": source.get("dependencies", []), "evidence": source.get("evidence", []),
                  "difference_offsets": "relative to compared region start",
                  "original_address": byte_diff(left, rebuilt[offset:min(offset + size, len(rebuilt))], max_ranges=max_ranges),
                  "mapped_output": None}
        if not mapped_row:
            errors.append(f"{identity}: missing rebuilt component mapping")
        else:
            dest, dest_size = mapped_row["offset"], mapped_row["size"]
            region["mapped_output"] = {"offset": dest, "size": dest_size,
                **byte_diff(left, rebuilt[dest:dest + dest_size], max_ranges=max_ranges)}
        reports.append(region)
    masks, admitted = [], []
    for mask in policy_masks or []:
        reasons = []
        if not isinstance(mask, dict):
            mask = {"invalid_record": repr(mask)}
        if not _span(mask, min(len(original), len(rebuilt))):
            reasons.append("invalid mask range")
        for field in ("reason", "provenance", "producerProof"):
            if not mask.get(field):
                reasons.append(f"missing {field}")
        verified = False
        if not reasons and evidence_verifier:
            try:
                verified = evidence_verifier("mask", mask) is True
            except Exception as exc:
                reasons.append(f"proof verifier failed: {exc}")
        if not verified:
            reasons.append("producer proof not independently admitted")
        masks.append({**mask, "admitted": not reasons, "reasons": reasons})
        if not reasons:
            admitted.append((mask["offset"], mask["offset"] + mask["size"]))
    merged = []
    for start, end in sorted(admitted):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    ignored_bytes = ignored_differences = 0
    for start, end in merged:
        ignored_bytes += end - start
        ignored_differences += byte_diff(original[start:end], rebuilt[start:end])["different_bytes"]
    evidence = []
    for certificate in certificates or []:
        admitted_proof = False
        reason = "no registered proof verifier; certificate retained as a claim"
        if evidence_verifier:
            try:
                admitted_proof = evidence_verifier("certificate", certificate) is True
                reason = "owner verifier accepted scoped evidence" if admitted_proof else "owner verifier rejected evidence"
            except Exception as exc:
                reason = f"proof verifier failed: {exc}"
        evidence.append({"certificate": certificate, "admitted": admitted_proof, "reason": reason})
    preserved = strata["opaque-preserved"] + strata["raw-captured"] + strata["object-captured"]
    report = {"schema": "gameverse.rom-reconstruction-comparison/1", "status": "passed" if raw["exact"] and not errors else "failed",
        "raw": raw, "generated_output_regions": output_only, "validation": {"valid": not errors, "errors": errors}, "components": reports,
        "coverage": {"source_bytes": len(original), "unattributed_source_bytes": gaps,
                     "unattributed_output_bytes": output_gaps, "stratum_bytes": strata,
                     "opaque_or_captured_bytes": preserved,
                     "semantic_unknown_bytes": len(original),
                     "declared_regenerated_bytes": sum(strata[key] for key in STRATA - {"opaque-preserved", "raw-captured", "object-captured"}),
                     "regeneration_verified_by_this_comparator": False,
                     "classification": "capture-only" if preserved == len(original) else "mixed-or-regenerated",
                     "note": "byte identity and source attribution do not certify recovered semantics"},
        "policy_masked": {"requested": bool(policy_masks), "masks": masks,
                          "ignored_ranges": [{"offset": start, "size": end - start} for start, end in merged],
                          "ignored_bytes": ignored_bytes, "ignored_different_bytes": ignored_differences,
                          "compared_bytes": raw["compared_bytes"] - ignored_bytes,
                          "different_bytes": raw["different_bytes"] - ignored_differences,
                          "matches_under_policy": raw["different_bytes"] == ignored_differences and all(row["admitted"] for row in masks),
                          "changes_raw_result": False},
        "encoding_aware": {"status": "unsupported", "reason": "no registered encoding transform proof; encoded bytes remain raw-compared"},
        "relocation_aware": {"status": "mapped-byte-comparison-only", "semantic_equivalence": None},
        "semantic_evidence": {"certificates": evidence, "whole_game_equivalent": None,
                              "note": "scoped native/source certificates remain separate from raw byte verification"},
        "gba_header": {"original": _gba_header(original), "rebuilt": _gba_header(rebuilt)},
        "context": {"game_id": manifest.get("game_id"), "provenance": manifest.get("provenance"),
                    "manifest_schema": manifest.get("schema"), "run_id": layout.get("run_id"),
                    "source_commit": manifest.get("provenance", {}).get("source_commit") if isinstance(manifest.get("provenance"), dict) else None},
        "timing": {"comparison_wall_s": time.perf_counter() - began, "queue_s": None,
                   "build_s": None, "machine": platform.platform(), "toolchain": platform.python_version()}}
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "original", "rebuilt", "layout", "output"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--policy", type=Path, help="JSON with explicit masks and certificates; unverified proofs stay unadmitted")
    parser.add_argument("--max-ranges", type=int, default=128)
    args = parser.parse_args(argv)
    # Exclusivity preserves passing and failed baseline reports on every run.
    if args.output.exists():
        parser.error("output already exists; choose a fresh report path")
    parse_errors = []
    def read_json(path):
        try:
            value = json.loads(path.read_text())
            if not isinstance(value, dict):
                raise ValueError("expected JSON object")
            return value
        except (OSError, ValueError) as exc:
            parse_errors.append(f"{path}: {exc}")
            return {}
    policy = read_json(args.policy) if args.policy else {}
    manifest, layout = read_json(args.manifest), read_json(args.layout)
    report = compare_reconstruction(args.original.read_bytes(), args.rebuilt.read_bytes(),
        manifest, layout, policy.get("masks"),
        policy.get("certificates"), max_ranges=args.max_ranges)
    report["validation"]["errors"].extend(parse_errors)
    artifact_pins = []
    for component in manifest.get("components", []):
        pin = component.get("artifact", {})
        if not pin.get("path"):
            error = f"{component.get('id')}: component artifact path missing"
        else:
            artifact_path = args.manifest.parent / pin["path"]
            try:
                actual_hash = sha256(artifact_path.read_bytes())
                error = None if actual_hash == pin.get("sha256") else f"{component.get('id')}: component artifact hash mismatch"
                artifact_pins.append({"id": component.get("id"), "path": str(artifact_path.resolve()),
                                      "sha256": actual_hash, "valid": error is None})
            except OSError as exc:
                error = f"{component.get('id')}: component artifact unavailable: {exc}"
        if error:
            report["validation"]["errors"].append(error)
    report["artifact_pins"] = artifact_pins
    report["validation"]["valid"] = not report["validation"]["errors"]
    if not report["validation"]["valid"]:
        report["status"] = "failed"
    report["inputs"] = {}
    for name in ("manifest", "original", "rebuilt", "layout"):
        path = getattr(args, name)
        report["inputs"][name] = {"path": str(path.resolve()),
                                   "sha256": sha256(path.read_bytes()) if path.is_file() else None}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({"status": report["status"], "raw_exact": report["raw"]["exact"],
                      "different_bytes": report["raw"]["different_bytes"], "report": str(args.output)}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
