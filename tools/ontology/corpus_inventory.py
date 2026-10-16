# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml>=6"]
# ///
"""Inventory evidence across every indexed ROM without running models or emulation.

uv run tools/ontology/corpus_inventory.py --out local/re/corpus_inventory.json
Counts describe retained evidence, never complete extraction or factual accuracy.
"""
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

import yaml

ROOT = Path(__file__).resolve().parents[2]
MEDIA_SUFFIXES = {".png", ".pal", ".4bpp", ".8bpp", ".wav", ".aif", ".mid", ".bin"}


def git(path, *args):
    result = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def source_inventory(path):
    counts = Counter()
    for folder, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "build", ".venv"}]
        for file in files:
            suffix = Path(file).suffix.lower()
            if suffix in MEDIA_SUFFIXES or suffix in {".c", ".h", ".s", ".inc"}:
                counts[suffix] += 1
    return {"path": str(path), "commit": git(path, "rev-parse", "HEAD"),
            "source_dirty": bool(git(path, "status", "--porcelain")),
            "file_counts": dict(sorted(counts.items())),
            "asset_semantics": "not established by suffix counts; .bin may contain non-media data"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "local/re/corpus_inventory.json")
    ap.add_argument("--capture-root", type=Path, default=ROOT / "local/captures")
    ap.add_argument("--ghidra-root", action="append", type=Path,
                    help="Additional output root to inspect; repeat for parallel shards")
    args = ap.parse_args()
    t0 = time.perf_counter()
    roms = json.loads((ROOT / "local/re/roms.json").read_text())
    survey = {r["id"]: r for r in json.loads((ROOT / "local/decomps/survey.json").read_text())}
    repo_cache = {}
    rows = []
    for rom in roms:
        gid = rom["id"]
        cap = args.capture_root.resolve() / gid
        summary_path = cap / "summary.json"
        summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
        game_path = ROOT / "ontology/games" / (gid + ".yaml")
        game = yaml.safe_load(game_path.read_text()) if game_path.exists() else {}
        projects = []
        for name in survey.get(gid, {}).get("clone_paths", []):
            path = Path(name)
            # Survey paths may come from another checkout; prefer current corpus.
            if not path.is_dir():
                path = ROOT / "local/decomps" / path.name
            if path.is_dir():
                repo_cache.setdefault(str(path), None)
                if repo_cache[str(path)] is None:
                    repo_cache[str(path)] = source_inventory(path)
                projects.append(repo_cache[str(path)])
        labels = cap / "gameplay_d1.jsonl"
        scored = [json.loads(line) for line in labels.read_text().splitlines()] if labels.exists() else []
        pending_script = ROOT / "tools/re/capture/scripts" / (gid + ".json")
        used = summary.get("scripts", [])
        ghidra_candidates = [root / gid / "functions.jsonl"
                             for root in [ROOT / "local/re", *(args.ghidra_root or [])]]
        ghidra = next((p.resolve() for p in ghidra_candidates if p.exists()), ghidra_candidates[0])
        recorded_hashes = summary.get("script_sha256")
        script_match = (all((ROOT / "tools/re/capture/scripts" / name).is_file() and
                            hashlib.sha256((ROOT / "tools/re/capture/scripts" / name).read_bytes()).hexdigest() == expected
                            for name, expected in recorded_hashes.items()) if recorded_hashes else None)
        rows.append({
            "id": gid, "rom_sha1": rom["sha1"], "game_code": rom["game_code"], "rom_version": rom["version"],
            "source_repositories": projects,
            "source_to_rom_mapping": "survey candidate; rebuild identity not established by this inventory",
            "capture": {"run_id": summary.get("run_id"), "outcome": summary.get("outcome"),
                        "rom_hash_matches_index": summary.get("sha1") == rom["sha1"] if summary else None,
                        "phases": [p["name"] for p in summary.get("phases", [])],
                        "keyframes": sum(1 for _ in cap.glob("*/keyframes/*.png")),
                        "d1_scored_frames": len(scored),
                        "d1_predicted_gameplay_frames": sum(r.get("p_gameplay") is not None and r["p_gameplay"] >= .6 for r in scored),
                        "d1_errors": sum(r.get("p_gameplay") is None for r in scored),
                        "custom_script_not_in_recorded_run": pending_script.exists() and pending_script.name not in used,
                        "script_content_match": script_match,
                        "caveat": "d1 predictions are not verified gameplay; listed script names do not pin script content"},
            "ghidra_export": {"present": ghidra.exists(), "path": str(ghidra) if ghidra.exists() else None},
            "ontology": {"present": bool(game), "components": len(game.get("components", [])),
                         "facets": dict(Counter(c["facet"] for c in game.get("components", []))),
                         "sha256": hashlib.sha256(game_path.read_bytes()).hexdigest() if game else None},
            "not_established": ["all mechanics mined", "asset address/format/use catalogue", "complete story/script graph",
                                "playtested strategies and skills", "complete ROM function discovery", "complete GBA hardware coverage"],
        })
    report = {"inventory_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
              "source_commit": git(ROOT, "rev-parse", "HEAD"), "source_dirty": bool(git(ROOT, "status", "--porcelain")),
              "tool_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "python": platform.python_version(), "machine": platform.platform(),
              "capture_root": str(args.capture_root.resolve()),
              "rom_count": len(rows), "unique_source_repositories": len(repo_cache),
              "ontologies": sum(r["ontology"]["present"] for r in rows),
              "ghidra_exports": sum(r["ghidra_export"]["present"] for r in rows),
              "games": rows, "wall_s": round(time.perf_counter() - t0, 4),
              "timing": {"queue_s": None, "build_s": None, "simulation_s": None, "provider_calls": 0}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("rom_count", "unique_source_repositories", "ontologies", "ghidra_exports", "wall_s")}))


if __name__ == "__main__":
    main()
