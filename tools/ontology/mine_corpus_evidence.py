"""Mine retained hardware measurements and source asset candidates across the corpus.

No model calls or new dependencies. Outputs are evidence packets, not complete game
ontologies. Asset contents/ROM offsets/semantic use are deliberately not inferred.
python3 tools/ontology/mine_corpus_evidence.py
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
ASSET_TYPES = {".png": "source_image", ".pal": "palette_candidate", ".wav": "source_audio",
               ".aif": "source_audio", ".mid": "sequence_candidate", ".4bpp": "tile_candidate",
               ".8bpp": "tile_candidate", ".bin": "untyped_data_blob"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(path, *args):
    result = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def leaves(obj, path=""):
    if isinstance(obj, dict):
        for key, value in sorted(obj.items()):
            yield from leaves(value, path + "/" + str(key))
    else:
        yield path, obj


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--capture-root", type=Path, default=ROOT / "local/captures")
    args = ap.parse_args()
    capture_root = args.capture_root.resolve()
    started = time.perf_counter()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    out = ROOT / "local/ontology-mining" / run_id
    out.mkdir(parents=True)
    report = {"run_id": run_id, "miner_version": 1, "started_at": datetime.now(timezone.utc).isoformat(),
              "source_commit": git(ROOT, "rev-parse", "HEAD"), "source_dirty": bool(git(ROOT, "status", "--porcelain")),
              "tool_sha256": sha(Path(__file__)), "python": platform.python_version(), "machine": platform.platform(),
              "provider_calls": 0, "build_s": None, "simulation_s": None, "queue_s": None,
              "capture_root": str(capture_root),
              "attempts": 1, "repairs": 0, "outcome": "running", "games": [], "repositories": [],
              "limitations": ["Reuses retained capture runs; does not execute games or verify player control.",
                              "Hardware facts are limited to the recorded phases and harness thresholds.",
                              "Asset candidates are files in source checkouts, not extracted ROM assets.",
                              "No asset role, ROM address, palette linkage, animation or reuse compatibility is inferred.",
                              "No source-to-ROM byte identity is established by this inventory."]}
    report_path = out / "run.json"
    def save():
        report["wall_s"] = round(time.perf_counter() - started, 4)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    save()
    try:
        roms = json.loads((ROOT / "local/re/roms.json").read_text())
        with (out / "hardware.jsonl").open("w") as stream:
            for rom in roms:
                gid = rom["id"]
                path = capture_root / gid / "summary.json"
                if not path.exists():
                    report["games"].append({"id": gid, "outcome": "missing_capture", "facts": 0})
                    continue
                summary = json.loads(path.read_text())
                if summary.get("sha1") != rom["sha1"] or summary.get("outcome") != "ok":
                    report["games"].append({"id": gid, "outcome": "capture_not_qualified", "facts": 0})
                    continue
                count = 0
                summary_hash = sha(path)
                for field, value in leaves(summary.get("derived", {}), "/derived"):
                    # Thresholds describe the instrument rather than a game property.
                    if field.startswith("/derived/thresholds/"):
                        continue
                    domain = "audio" if field.startswith("/derived/sound/") else "hardware" if field.startswith("/derived/swi_") else "rendering"
                    row = {"game_id": gid, "domain": domain, "property": field, "value": value,
                           "status": "observed_in_recorded_capture", "rom_sha1": rom["sha1"],
                           "evidence": {"kind": "capture_telemetry", "ref": str(path) + "#" + field,
                                        "sha256": summary_hash, "capture_run_id": summary.get("run_id")},
                           "scope": {"phases": [p["name"] for p in summary.get("phases", [])],
                                     "frames": summary.get("frames_emulated"), "instrument": summary.get("context"),
                                     "thresholds": summary.get("derived", {}).get("thresholds"),
                                     "negative_values_are_not_global_absence": True}}
                    stream.write(json.dumps(row) + "\n")
                    count += 1
                report["games"].append({"id": gid, "outcome": "ok", "facts": count})
        survey = json.loads((ROOT / "local/decomps/survey.json").read_text())
        repos = {}
        for game in survey:
            for name in game.get("clone_paths", []):
                path = ROOT / "local/decomps" / Path(name).name
                if path.is_dir():
                    repos.setdefault(path, []).append(game["id"])
        with (out / "assets.jsonl").open("w") as stream:
            for repo, games in sorted(repos.items()):
                commit = git(repo, "rev-parse", "HEAD")
                counts = Counter()
                for folder, dirs, files in os.walk(repo):
                    dirs[:] = sorted(d for d in dirs if d not in {".git", "build", "node_modules", ".venv"})
                    for name in sorted(files):
                        path = Path(folder) / name
                        kind = ASSET_TYPES.get(path.suffix.lower())
                        if kind and path.is_file() and not path.is_symlink():
                            row = {"source_repo": repo.name, "commit": commit, "game_candidates": sorted(games),
                                   "path": str(path.relative_to(repo)), "candidate_kind": kind,
                                   "size_bytes": path.stat().st_size, "sha256": sha(path),
                                   "status": "source_file_candidate", "rom_address": None, "semantic_role": None}
                            stream.write(json.dumps(row) + "\n")
                            counts[kind] += 1
                report["repositories"].append({"name": repo.name, "commit": commit,
                                                "source_dirty": bool(git(repo, "status", "--porcelain")),
                                                "candidate_counts": dict(counts)})
        report["outcome"] = "ok"
    except BaseException as error:
        report["outcome"] = "cancelled" if isinstance(error, KeyboardInterrupt) else "failed"
        report["error_type"] = type(error).__name__
        raise
    finally:
        report["ended_at"] = datetime.now(timezone.utc).isoformat()
        save()
        print(json.dumps({"run": str(out), "outcome": report["outcome"], "wall_s": report["wall_s"],
                          "games": len(report["games"]), "facts": sum(r["facts"] for r in report["games"]),
                          "asset_candidates": sum(sum(r["candidate_counts"].values()) for r in report["repositories"])}))


if __name__ == "__main__":
    main()
