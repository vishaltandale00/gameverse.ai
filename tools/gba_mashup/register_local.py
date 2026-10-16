#!/usr/bin/env python3
"""Register a qualified native fork in the existing local development catalog.

This is local artifact installation, not a production activation/migration API.
An existing different receipt is preserved: use a new version ID for new forks.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
GAME_ID = "mzm-emerald-encounters-v1"
REQUIRED = ("right_control", "left_control", "jump_rise", "encounter",
            "native_party_switch", "native_turn_resolved", "native_player_attack",
            "world_frozen_during_battle", "exploration_control_restored")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-receipt", type=Path, required=True)
    parser.add_argument("--qualification", type=Path, required=True)
    args = parser.parse_args()
    args.build_receipt = args.build_receipt.resolve()
    args.qualification = args.qualification.resolve()
    build = json.loads(args.build_receipt.read_text())
    qualification = json.loads(args.qualification.read_text())
    recipe = ROOT / "tools/gba_mashup/recipes" / (GAME_ID + ".json")
    spec = json.loads(recipe.read_text())
    if build.get("outcome") != "built" or not build.get("candidate"):
        raise ValueError("A successful native candidate build receipt is required")
    rom = Path(build["output"]["path"])
    digest = sha(rom)
    if digest != build["output"]["sha256"] or digest != qualification["rom"]["sha256"]:
        raise ValueError("Build, qualification and ROM identities differ")
    if qualification.get("build_receipt", {}).get("sha256") != sha(args.build_receipt):
        raise ValueError("Qualification did not pin these build receipt bytes")
    if build["source_commit"] != spec["parent_games"][0]["source_commit"]:
        raise ValueError("Foundation source pin differs from recipe")
    if not qualification.get("success") or not all(qualification.get("witnesses", {}).get(key) is True for key in REQUIRED):
        raise ValueError("Native encounter/attack/switch/return qualification incomplete")
    media = args.qualification.parent
    if not (media / "playthrough.mp4").is_file() or not list(media.glob("observation-*.png")):
        raise ValueError("Recorded actual-emulator media required")
    if qualification.get("video", {}).get("sha256") != sha(media / "playthrough.mp4"):
        raise ValueError("Video differs from the qualified recording")
    observations = qualification.get("observations", [])
    if not observations:
        raise ValueError("Qualified observations required")
    for observation in observations:
        path = Path(observation["image"]).resolve()
        if path.parent != media or observation.get("evidence", {}).get("image_sha256") != sha(path):
            raise ValueError("Screenshot differs from its qualified observation")
    receipt = {"gameId": GAME_ID, "sourceCommit": build["source_commit"],
               "sourceDiffSha256": build["native_source_patch"]["sha256"],
               "recipeSha256": sha(recipe), "sha256": digest, "baselineMatches": False,
               "runId": qualification["run_id"], "builtAt": dt.datetime.fromtimestamp(rom.stat().st_mtime, dt.timezone.utc).isoformat(),
               "qualification": "Native controls, encounters, attack, party switch and world return observed; full campaign pending",
               "qualificationReportSha256": sha(args.qualification),
               "qualificationGameId": qualification["game_id"],
               "buildReceiptSha256": sha(args.build_receipt), "saveCompatibility": "fresh independent fork progress",
               "parentGames": spec["parent_games"], "nativeSourceSha256": build["native_source_sha256"],
               "media": {"video": str((media / "playthrough.mp4").relative_to(ROOT)),
                         "videoSha256": sha(media / "playthrough.mp4")}}
    target = ROOT / "local-data/games"
    target.mkdir(parents=True, exist_ok=True)
    destination = target / (GAME_ID + ".json")
    if destination.exists():
        existing = json.loads(destination.read_text())
        if existing["sha256"] != digest or existing.get("recipeSha256") != receipt["recipeSha256"]:
            raise ValueError("Existing game version differs; preserve it and use an explicitly new version")
        # The exact same ROM/recipe may gain stronger qualification metadata;
        # it never changes artifact or save identity.
        if existing == receipt:
            print(json.dumps({"game_id": GAME_ID, "outcome": "already_registered", "sha256": digest}))
            return
    artifact = target / (digest + ".gba")
    if not artifact.exists() or sha(artifact) != digest:
        temporary_rom = artifact.with_suffix(".gba.tmp")
        shutil.copyfile(rom, temporary_rom)
        if sha(temporary_rom) != digest:
            raise ValueError("Artifact changed during installation")
        temporary_rom.replace(artifact)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(receipt, indent=2) + "\n")
    temporary.replace(destination)
    print(json.dumps({"game_id": GAME_ID, "outcome": "registered_local_fork", "sha256": digest}))


if __name__ == "__main__":
    main()
