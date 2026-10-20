#!/usr/bin/env python3
"""Bounded ROM-first breadth campaign; retain failures and publish honest coverage.

Runs the existing headless exporter without fetching any community source. Each
completed ROM updates its portrait's research_progress, never its mechanic grade.
Semantic promotion remains a separate instruction/dynamic review.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
LOCK = threading.Lock()


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n")
    tmp.replace(path)


def prior_exports(game_id):
    found = []
    for p in (ROOT / "local/re").glob("**/" + game_id + "/functions.jsonl"):
        try:
            s = json.loads(p.with_name("summary.json").read_text())
        except (OSError, ValueError):
            s = {}
        found.append({"ref": str(p.relative_to(ROOT)), "sha256": digest(p),
                      "functions": sum(1 for _ in p.open()), "run_id": s.get("run_id"),
                      "status": "partial_binary_export_not_whole_game"})
    return found


def publish(rom, directory, result, campaign_id):
    export = directory / "functions.jsonl"
    summary = directory / "summary.json"
    facts = {"campaign_id": campaign_id, "recorded_at": stamp(),
             "rom_sha1": rom["sha1"], "status": result.get("status", "failed"),
             "function_records": result.get("function_count"),
             "pseudo_c_generated": result.get("decompiled"),
             "process_wall_s": result.get("wall_s"), "queue_s": None,
             "scope": "ROM binary; push-LR pointer seeds plus direct-call expansion; no community source input",
             "whole_game_decompiled": False, "mechanic_validation": "separate review required",
             "gaps": ["Indirect calls and undiscovered code", "Function boundaries and ABI recovery",
                      "Player/actor identity and gameplay reachability", "World/plot dependency graphs",
                      "Assets/data-to-code mapping and complete behavioral qualification"]}
    if export.exists() and summary.exists():
        records = [json.loads(line) for line in export.open()]
        facts.update(export_ref=str(export.relative_to(ROOT)), export_sha256=digest(export),
                     summary_ref=str(summary.relative_to(ROOT)), summary_sha256=digest(summary),
                     warning_function_count=sum("WARNING" in r.get("c", "") for r in records),
                     unknown_register_function_count=sum("unaff_" in r.get("c", "") for r in records),
                     candidate_mmio_functions=[{"entry": r["entry"], "io_ref": r["io_ref"]}
                                               for r in records if r.get("io_ref")][:100])
    else:
        facts["failure"] = result.get("error", "No completed export")
        if result.get("partial_journal"):
            facts["partial_journal"] = dict(result["partial_journal"])
            journal = Path(facts["partial_journal"]["path"])
            if not journal.is_absolute():
                journal = ROOT / journal
            facts["partial_journal"]["path"] = str(journal.relative_to(ROOT))
    returns = directory / "returns.json"
    if returns.exists():
        repair = json.loads(returns.read_text())
        facts["return_repair"] = {"ref": str(returns.relative_to(ROOT)), "sha256": digest(returns),
                                  "heuristic": True, "flow_overrides": repair.get("flow_overrides"),
                                  "note": "Saved-LR CFG aid; ABI and gameplay semantics remain unverified"}
    portrait = ROOT / "ontology/portraits" / (rom["id"] + ".json")
    if portrait.exists():
        p = json.loads(portrait.read_text())
        previous = p.setdefault("coverage", {}).get("research_progress", {})
        if previous.get("previous_attempt_refs"):
            facts["previous_attempt_refs"] = list(previous["previous_attempt_refs"])
        if previous.get("campaign_id") and previous["campaign_id"] != campaign_id:
            facts["previous_attempt_refs"] = sorted(set(previous.get("previous_attempt_refs", []) + [
                "research/corpus-mining/" + previous["campaign_id"] + "/" + rom["id"] + ".json"]))
        for key in ("native_operator_witness", "semantic_review_ref", "reviewed_operator_count",
                    "isolated_native_operator_vectors"):
            if key in previous:
                facts[key] = previous[key]
        p.setdefault("coverage", {})["research_progress"] = facts
        save(portrait, p)
    save(ROOT / "research/corpus-mining" / campaign_id / (rom["id"] + ".json"), facts)
    return facts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaign-id", required=True)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--rom-timeout", type=int, default=90)
    ap.add_argument("--total-budget", type=int, default=1800)
    ap.add_argument("--exclude", action="append", default=["sonic-advance"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--resume", action="store_true", help="retain completed/failed attempts and continue unattempted games")
    args = ap.parse_args()
    if min(args.jobs, args.rom_timeout, args.total_budget) < 1:
        ap.error("resource limits must be positive")
    roms = json.loads((ROOT / "local/re/roms.json").read_text())
    # Source-poor games first, without conflating source-file existence with depth.
    roms.sort(key=lambda r: ((ROOT / "ontology/games" / (r["id"] + ".yaml")).exists(), r["id"]))
    queue = [{**r, "prior_exports": prior_exports(r["id"]),
              "canonical_exists": (ROOT / "ontology/games" / (r["id"] + ".yaml")).exists(),
              "owner": "sonic_metroid_investigation" if r["id"] in args.exclude else "this_campaign"}
             for r in roms]
    manifest_path = ROOT / "research/corpus-mining" / args.campaign_id / "campaign.json"
    manifest = {"schema_version": 1, "campaign_id": args.campaign_id, "started_at": stamp(),
                "status": "running", "queue_s": None, "source_commit": subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "config": vars(args), "queue": queue, "results": [],
                "completion_criteria": "All games receive bounded binary pass, then reviewed movement/collision/AI/event/resource/render/asset seams; full-game completeness is not inferred from counts."}
    if args.resume:
        previous = json.loads(manifest_path.read_text())
        previous.setdefault("resumptions", []).append({"at": stamp(), "config": vars(args)})
        previous["status"] = "running"
        manifest = previous
    elif manifest_path.exists():
        ap.error("campaign already exists; use --resume or a fresh campaign id")
    save(manifest_path, manifest)
    selected = [r for r in roms if r["id"] not in args.exclude][:args.limit]
    attempted = {r["id"] for r in manifest["results"] if r.get("status") != "not_started_budget_exhausted"}
    selected = [r for r in selected if r["id"] not in attempted]
    start = time.monotonic()

    def run(rom):
        if time.monotonic() - start >= args.total_budget:
            return {"id": rom["id"], "status": "not_started_budget_exhausted"}
        out_root = ROOT / "local/re/experiments" / args.campaign_id / rom["id"]
        log = out_root / "runner.log"
        out_root.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        env["JAVA_TOOL_OPTIONS"] = "-Duser.home=" + str(ROOT / "local/re/ghidra-user")
        command = ["python3", "tools/re/ghidra/run_ghidra.py", rom["id"], "--jobs", "1",
                   "--xmx", "2G", "--max-cpu", "2", "--decomp-threads", "1",
                   "--decomp-timeout", "3", "--seed-oddptr", "push", "--no-auto-analysis",
                   "--discover-no-analysis", "--discover-mode", "calls", "--discover-rounds", "2",
                   "--discover-candidate-limit", "10000", "--discover-scan-timeout", "20",
                   "--capture-root", "local/captures-experiments/20261016-current-scripts",
                   "--max-capture-seeds", "1000", "--rom-timeout", str(args.rom_timeout),
                   "--out-root", str(out_root), "--note", "Binary-first breadth campaign; generated C is not validated mechanics"]
        with log.open("w") as stream:
            subprocess.run(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT)
        try:
            index = json.loads((out_root / "index.json").read_text())
            result = index["runs"][-1]["roms"][0]
        except (OSError, ValueError, IndexError) as exc:
            result = {"id": rom["id"], "status": "failed", "error": repr(exc)}
        with LOCK:
            publish(rom, out_root / rom["id"], result, args.campaign_id)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(run, rom) for rom in selected]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            manifest["results"].append(result)
            manifest["elapsed_wall_s"] = round(time.monotonic() - start, 3)
            save(manifest_path, manifest)
            print(json.dumps({k: result.get(k) for k in ("id", "status", "wall_s", "function_count", "decompiled", "error")}), flush=True)
    manifest.update(status="completed_with_gaps", ended_at=stamp(),
                    elapsed_wall_s=round(time.monotonic() - start, 3),
                    aggregate_rom_wall_s=round(sum(r.get("wall_s", 0) for r in manifest["results"]), 3))
    save(manifest_path, manifest)


if __name__ == "__main__":
    main()
