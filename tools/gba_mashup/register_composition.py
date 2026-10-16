#!/usr/bin/env python3
"""Install an evidence-pinned IR-built cartridge into the local Play catalog.

Build, plan, lock, native trace and recorded media must identify the same ROM.
Registration records the evidence's limited scope, not full-game qualification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_file(ref):
    path = (ROOT / ref).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError("Expected an existing workspace evidence file")
    return path


def pinned(record):
    path = local_file(record["ref"])
    if digest(path) != record["sha256"]:
        raise ValueError("Evidence hash mismatch: " + record["ref"])
    return path


def register(game_id, evidence_path, plan_id):
    evidence_path = local_file(str(evidence_path))
    evidence = json.loads(evidence_path.read_text())
    variant = evidence["plans"][plan_id]
    sources = json.loads((ROOT / "games/sources.json").read_text())
    source = sources["games"][game_id]
    plan = pinned(variant["plan"])
    if source.get("compositionPlan") != str(plan.relative_to(ROOT)):
        raise ValueError("Catalog and qualified composition plan differ")
    build_path, lock_path = pinned(variant["build_receipt"]), pinned(variant["lock"])
    build, lock = json.loads(build_path.read_text()), json.loads(lock_path.read_text())
    trace_path = pinned(variant["native_trace"])
    trace = json.loads(trace_path.read_text())
    rom = local_file(build["output"])
    sha = digest(rom)
    if build.get("outcome") != "built" or build.get("source_commit") != source["commit"]:
        raise ValueError("Build outcome or source identity differs")
    if any(value != sha for value in (variant["output_rom_sha256"], build["output_sha256"], lock["output_sha256"], trace["rom_sha256"])):
        raise ValueError("Build, native trace and lock refer to different cartridges")
    if trace.get("outcome") != "observed" or not trace.get("records"):
        raise ValueError("Retained native execution observations required")
    if trace.get("composition", {}).get("receipt", {}).get("output_sha256") != sha:
        raise ValueError("Native execution did not identify the built cartridge")
    if rom.read_bytes()[0xac:0xb0].decode("ascii") != source["gameCode"]:
        raise ValueError("Cartridge game code differs")
    for record in [*variant["observations"], variant["video"], *variant["packages"].values()]:
        pinned(record)
    receipt = {
        "gameId": game_id, "sourceCommit": source["commit"], "sha256": sha,
        "baselineMatches": False, "runId": trace_path.parent.name,
        "compositionPlanSha256": digest(plan), "compositionLockSha256": digest(lock_path),
        "buildReceiptSha256": digest(build_path), "qualificationReportSha256": digest(trace_path),
        "qualification": source["qualificationScope"],
        "saveCompatibility": "Fresh independent fork; progress isolated by game and cartridge identity",
        "evidenceRef": str(evidence_path.relative_to(ROOT)), "evidenceSha256": digest(evidence_path),
        "media": {"video": variant["video"]["ref"], "videoSha256": variant["video"]["sha256"]},
    }
    target = ROOT / "local-data/games"
    target.mkdir(parents=True, exist_ok=True)
    destination = target / (game_id + ".json")
    if destination.exists():
        old = json.loads(destination.read_text())
        if old["sha256"] != sha or old.get("compositionPlanSha256") != receipt["compositionPlanSha256"]:
            raise ValueError("Existing version differs; register an independent version")
    artifact = target / (sha + ".gba")
    if not artifact.exists() or digest(artifact) != sha:
        temporary = artifact.with_suffix(".gba.tmp")
        shutil.copyfile(rom, temporary)
        if digest(temporary) != sha:
            raise ValueError("Cartridge changed while copying")
        temporary.replace(artifact)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(receipt, indent=2) + "\n")
    temporary.replace(destination)
    return {"game_id": game_id, "outcome": "registered_local_composition", "sha256": sha}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--plan-id", required=True)
    args = parser.parse_args()
    print(json.dumps(register(args.game_id, args.evidence, args.plan_id)))
